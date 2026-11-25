//! Named pipes, opened for overlapped use so one thread can read while another writes.
use crate::util::{pcw, wide};
use std::io;
use std::sync::Arc;
use windows::core::PWSTR;
use windows::Win32::Foundation::*;
use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
use windows::Win32::Security::{GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER};
use windows::Win32::Storage::FileSystem::*;
use windows::Win32::System::Pipes::*;
use windows::Win32::System::Threading::{CreateEventW, GetCurrentProcess, OpenProcessToken};
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

pub struct Pipe(HANDLE);
unsafe impl Send for Pipe {}
unsafe impl Sync for Pipe {}
impl Drop for Pipe {
    fn drop(&mut self) {
        unsafe { let _ = CloseHandle(self.0); }
    }
}

struct Event(HANDLE);
impl Event {
    fn new() -> io::Result<Event> {
        unsafe { CreateEventW(None, true, false, None) }.map(Event).map_err(to_io)
    }
}
impl Drop for Event {
    fn drop(&mut self) {
        unsafe { let _ = CloseHandle(self.0); }
    }
}
fn to_io(e: windows::core::Error) -> io::Error {
    io::Error::new(io::ErrorKind::Other, e.message())
}

impl Pipe {
    fn finish(&self, started: windows::core::Result<()>, o: &OVERLAPPED) -> io::Result<usize> {
        if let Err(e) = started {
            if e.code() != ERROR_IO_PENDING.to_hresult() {
                return Err(to_io(e));
            }
        }
        let mut n = 0u32;
        unsafe { GetOverlappedResult(self.0, o, &mut n, true) }.map_err(to_io)?;
        Ok(n as usize)
    }
    pub fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
        let ev = Event::new()?;
        let mut o = OVERLAPPED { hEvent: ev.0, ..Default::default() };
        let r = unsafe { ReadFile(self.0, Some(buf), None, Some(&mut o)) };
        self.finish(r, &o)
    }
    pub fn write_all(&self, mut buf: &[u8]) -> io::Result<()> {
        while !buf.is_empty() {
            let ev = Event::new()?;
            let mut o = OVERLAPPED { hEvent: ev.0, ..Default::default() };
            let r = unsafe { WriteFile(self.0, Some(&buf[..buf.len().min(1 << 20)]), None, Some(&mut o)) };
            let n = self.finish(r, &o)?;
            if n == 0 {
                return Err(io::ErrorKind::WriteZero.into());
            }
            buf = &buf[n..];
        }
        Ok(())
    }
    /// Ends any read or write in progress.
    pub fn cancel(&self) {
        unsafe { let _ = CancelIoEx(self.0, None); }
    }
    pub fn disconnect(&self) {
        self.cancel();
        unsafe { let _ = DisconnectNamedPipe(self.0); }
    }
    /// Reads lines up to max bytes until the other side goes away or on_line says stop.
    pub fn lines(&self, max: usize, mut on_line: impl FnMut(&[u8]) -> bool) {
        let mut buf = vec![0u8; 64 * 1024];
        let mut line: Vec<u8> = Vec::new();
        while let Ok(n) = self.read(&mut buf) {
            if n == 0 {
                return;
            }
            let mut rest = &buf[..n];
            while let Some(i) = rest.iter().position(|&b| b == b'\n') {
                line.extend_from_slice(&rest[..i]);
                if line.len() > max || (!line.is_empty() && !on_line(&line)) {
                    return;
                }
                line.clear();
                rest = &rest[i + 1..];
            }
            line.extend_from_slice(rest);
            if line.len() > max {
                return;
            }
        }
    }
}

pub fn connect(name: &str) -> io::Result<Pipe> {
    let n = wide(name);
    for _ in 0..20 {
        // Anonymous: the other side may not act as this user.
        let r = unsafe {
            CreateFileW(pcw(&n), (GENERIC_READ | GENERIC_WRITE).0, FILE_SHARE_NONE, None, OPEN_EXISTING, FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS, None)
        };
        match r {
            Ok(h) => return Ok(Pipe(h)),
            Err(e) if e.code() == ERROR_PIPE_BUSY.to_hresult() => unsafe { let _ = WaitNamedPipeW(pcw(&n), 250); },
            Err(e) => return Err(to_io(e)),
        }
    }
    Err(io::ErrorKind::TimedOut.into())
}

pub fn user_sid() -> io::Result<String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(to_io)?;
        let mut len = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
        let mut buf = vec![0u64; (len as usize).div_ceil(8)];
        let r = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut _), len, &mut len);
        let _ = CloseHandle(token);
        r.map_err(to_io)?;
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut s = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut s).map_err(to_io)?;
        let out = s.to_string().map_err(|_| io::ErrorKind::InvalidData.into());
        LocalFree(HLOCAL(s.0 as *mut _));
        out
    }
}

/// Serves a pipe that only this user can open, from the moment it exists. Network logons are denied.
pub struct Listener {
    name: Vec<u16>,
    sd: PSECURITY_DESCRIPTOR,
    first: bool,
    next: Option<Pipe>,
}
unsafe impl Send for Listener {}
impl Listener {
    pub fn new(name: &str) -> io::Result<Listener> {
        let sddl = wide(&format!("D:P(D;;GA;;;NU)(A;;GA;;;{})", user_sid()?));
        let mut sd = PSECURITY_DESCRIPTOR::default();
        unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(pcw(&sddl), SDDL_REVISION_1, &mut sd, None) }.map_err(to_io)?;
        let mut l = Listener { name: wide(name), sd, first: true, next: None };
        l.next = Some(l.instance()?);
        Ok(l)
    }
    fn instance(&mut self) -> io::Result<Pipe> {
        let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: self.sd.0, bInheritHandle: false.into() };
        let mut open = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED;
        if self.first {
            open |= FILE_FLAG_FIRST_PIPE_INSTANCE; // fail rather than join a pipe someone else made
        }
        let h = unsafe { CreateNamedPipeW(pcw(&self.name), open, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, PIPE_UNLIMITED_INSTANCES, 65536, 65536, 0, Some(&sa)) };
        if h == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        self.first = false;
        Ok(Pipe(h))
    }
    /// Waits for the next client. Another instance is ready before this one is handed over.
    pub fn accept(&mut self) -> io::Result<Arc<Pipe>> {
        let p = match self.next.take() {
            Some(p) => p,
            None => self.instance()?,
        };
        let ev = Event::new()?;
        let mut o = OVERLAPPED { hEvent: ev.0, ..Default::default() };
        let r = unsafe { ConnectNamedPipe(p.0, Some(&mut o)) };
        match &r {
            Err(e) if e.code() == ERROR_PIPE_CONNECTED.to_hresult() => {}
            _ => { p.finish(r, &o)?; }
        }
        self.next = Some(self.instance()?);
        Ok(Arc::new(p))
    }
}
