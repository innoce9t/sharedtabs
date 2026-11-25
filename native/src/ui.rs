// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
//! The setup window: one small dark window that shows a page of text, tick boxes and buttons.
//! Real Windows controls are used underneath, so keyboard and screen readers work.
use crate::util::{pcw, wide};
use crate::{agents, install, update};
use std::result::Result::Ok; // GDI+ has a constant of the same name
use std::sync::mpsc::{channel, Receiver, Sender};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Graphics::GdiPlus::*;
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::UI::Controls::*;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::{EnableWindow, GetFocus, SetFocus};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::*;

const BG: u32 = 0x0a0a0a;
const CARD: u32 = 0x171717;
const FG: u32 = 0xffffff;
const MUTED: u32 = 0xc0c0c0;
const ACCENT: u32 = 0x4f7cff;
const SOLID: u32 = 0x3f6bf0;
const VIOLET: u32 = 0x8b5cf6;
const WARN: u32 = 0xf5b942;
const WIDTH: i32 = 480;
const PAD: i32 = 24;
const SS_NOPREFIX: u32 = 0x80;
const APP_PAGE: u32 = WM_APP + 1;
const WAIT_TIMER: usize = 1;

fn rgb(c: u32) -> COLORREF {
    COLORREF((c & 0xff) << 16 | (c & 0xff00) | c >> 16)
}
fn argb(c: u32) -> u32 {
    0xff00_0000 | c
}

#[derive(Clone, Copy, PartialEq)]
pub enum Do {
    Install,
    Connect,
    Copy,
    OpenHelp,
    AddToChrome,
    CheckUpdate,
    ApplyUpdate,
    AskRemove,
    Remove,
    Home,
    Close,
}
#[derive(Clone)]
pub struct Page {
    title: &'static str,
    text: String,
    warn: bool,
    ticks: Vec<(String, String, bool)>, // id, label, ticked
    buttons: Vec<(&'static str, Do)>,   // the first is the main one
    busy: bool,
    waiting: bool, // for Chrome to connect
}
fn page(title: &'static str, text: impl Into<String>, buttons: &[(&'static str, Do)]) -> Page {
    Page { title, text: text.into(), warn: false, ticks: vec![], buttons: buttons.to_vec(), busy: false, waiting: false }
}
fn working(title: &'static str) -> Page {
    Page { busy: true, ..page(title, "This takes a moment.", &[]) }
}
fn problem(text: String) -> Page {
    Page { warn: true, ..page("That didn't work", text, &[("Close", Do::Close)]) }
}

fn ticks() -> Vec<(String, String, bool)> {
    agents::found().iter().map(|a| (a.id.to_string(), a.name.to_string(), false)).collect()
}
fn setup_page() -> Page {
    let again = install::installed_version();
    let mut p = page(
        if again.is_some() { "Install again" } else { "Set up SharedTabs" },
        match again {
            Some(v) => format!("Version {v} is installed. This puts version {} in its place. Tick any agents to connect.", crate::util::VERSION),
            None => "This small app connects the SharedTabs extension to AI agents on this computer. It installs for your account only, and runs only while Chrome or an agent needs it.\n\nTick the agents to connect. Each one will be able to use the tabs you share.".into(),
        },
        &[("Install", Do::Install), ("Cancel", Do::Close)],
    );
    p.ticks = ticks();
    p
}
fn home_page() -> Page {
    let mut p = page(
        "SharedTabs Bridge",
        format!("Version {} is installed. Tick an agent to connect it, or use Copy settings for one that isn't listed.", install::installed_version().unwrap_or_else(|| crate::util::VERSION.into())),
        &[("Connect", Do::Connect), ("Copy settings", Do::Copy), ("Check for updates", Do::CheckUpdate), ("Remove", Do::AskRemove)],
    );
    if !update::configured() {
        p.buttons.retain(|b| b.1 != Do::CheckUpdate);
    }
    p.ticks = ticks();
    p
}
fn connect_ticked(ids: &[String]) -> (String, bool) {
    let mut ok = true;
    let lines: Vec<String> = agents::found()
        .iter()
        .filter(|a| ids.iter().any(|i| i == a.id))
        .map(|a| a.connect(&install::exe()).unwrap_or_else(|e| { ok = false; format!("{}: {e}.", a.name) }))
        .collect();
    (lines.join("\n"), ok)
}

/// Work that may take a while. Runs off the window's thread.
fn perform(what: Do, ids: Vec<String>, release: Option<update::Release>) -> (Page, Option<update::Release>) {
    let next = match what {
        Do::Install => match install::install() {
            Ok(()) => {
                let (lines, ok) = connect_ticked(&ids);
                let mut t = String::from("The bridge is installed. Now add the SharedTabs extension to Chrome. If you already have it, turn it off and on in chrome://extensions.\n\nWaiting for Chrome...");
                if !lines.is_empty() {
                    t += &format!("\n\n{lines}");
                }
                Page { warn: !ok, waiting: true, ..page("Add it to Chrome", t, &[("Add to Chrome", Do::AddToChrome), ("Copy settings for another agent", Do::Copy), ("Done", Do::Close)]) }
            }
            Err(e) => problem(e),
        },
        Do::Connect => {
            if ids.is_empty() {
                let mut p = home_page();
                p.text = "Tick at least one agent first.".into();
                p
            } else {
                let (lines, ok) = connect_ticked(&ids);
                Page { warn: !ok, ..page("Agents", lines, &[("Done", Do::Close), ("Back", Do::Home)]) }
            }
        }
        Do::CheckUpdate => match update::check() {
            Ok(Some(r)) => {
                let p = page("Update available", format!("Version {} is ready, and its signature is valid.\n\n{}", r.version, r.notes), &[("Install update", Do::ApplyUpdate), ("Not now", Do::Close)]);
                return (p, Some(r));
            }
            Ok(None) => page("Up to date", "You have the newest version.", &[("Close", Do::Close)]),
            Err(e) => problem(e),
        },
        Do::ApplyUpdate => match release.as_ref().map(update::apply) {
            Some(Ok(())) => page("Updated", "The new version is in place. To start using it, restart Chrome and your agents. Your settings are kept in Chrome.", &[("Done", Do::Close)]),
            Some(Err(e)) => problem(e),
            None => home_page(),
        },
        Do::Remove => {
            let notes = install::uninstall();
            page("Removed", format!("SharedTabs Bridge has been removed. The extension stays in Chrome until you remove it there.{}", if notes.is_empty() { String::new() } else { format!("\n\n{}", notes.join("\n")) }), &[("Close", Do::Close)])
        }
        Do::AskRemove => page("Remove SharedTabs Bridge?", "Agents will no longer be able to use your tabs. Your settings in the Chrome extension are kept.", &[("Remove", Do::Remove), ("Cancel", Do::Close)]),
        _ => home_page(),
    };
    (next, None)
}

struct Window {
    hwnd: HWND,
    page: Page,
    release: Option<update::Release>,
    controls: Vec<HWND>,
    fonts: Vec<HFONT>,
    brush: HBRUSH,
    card: RECT,
    inbox: Receiver<(Page, Option<update::Release>)>,
    outbox: Sender<(Page, Option<update::Release>)>,
}

impl Window {
    fn px(&self, n: i32) -> i32 {
        n * unsafe { GetDpiForWindow(self.hwnd) } as i32 / 96
    }
    unsafe fn font(&mut self, size: i32, weight: i32) -> HFONT {
        let f = CreateFontW(-self.px(size), 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET.0 as u32, OUT_DEFAULT_PRECIS.0 as u32, CLIP_DEFAULT_PRECIS.0 as u32, CLEARTYPE_QUALITY.0 as u32, 0, w!("Segoe UI"));
        self.fonts.push(f);
        f
    }
    unsafe fn measure(&self, text: &str, font: HFONT, width: i32) -> i32 {
        let dc = GetDC(self.hwnd);
        let old = SelectObject(dc, font);
        let mut r = RECT { right: width, ..Default::default() };
        let mut t: Vec<u16> = text.encode_utf16().collect();
        DrawTextW(dc, &mut t, &mut r, DT_CALCRECT | DT_WORDBREAK | DT_NOPREFIX);
        SelectObject(dc, old);
        ReleaseDC(self.hwnd, dc);
        r.bottom + 2
    }
    unsafe fn add(&mut self, class: PCWSTR, text: &str, style: u32, r: RECT, id: i32, font: HFONT) -> HWND {
        let t = wide(text);
        let inst = GetModuleHandleW(None).unwrap_or_default();
        let h = CreateWindowExW(WINDOW_EX_STYLE(0), class, pcw(&t), WS_CHILD | WS_VISIBLE | WINDOW_STYLE(style), r.left, r.top, r.right - r.left, r.bottom - r.top, self.hwnd, HMENU(id as usize as *mut _), inst, None).unwrap_or_default();
        SendMessageW(h, WM_SETFONT, WPARAM(font.0 as usize), LPARAM(1));
        self.controls.push(h);
        h
    }

    /// Lays the page out again, and sizes the window to fit it.
    unsafe fn build(&mut self) {
        for h in self.controls.drain(..) {
            let _ = DestroyWindow(h);
        }
        for f in self.fonts.drain(..) {
            let _ = DeleteObject(f);
        }
        let (title, body, strong) = (self.font(24, 700), self.font(14, 400), self.font(14, 600));
        let (pad, inner) = (self.px(PAD), self.px(WIDTH - PAD * 2 - 40));
        let left = pad + self.px(20);
        let mut y = self.px(88);
        self.card = RECT { left: pad, top: y, right: self.px(WIDTH - PAD), bottom: 0 };
        y += self.px(18);
        let p = self.page.clone();
        let th = self.measure(p.title, title, inner);
        self.add(w!("STATIC"), p.title, SS_NOPREFIX, RECT { left, top: y, right: left + inner, bottom: y + th }, 900, title);
        y += th + self.px(8);
        let bh = self.measure(&p.text, body, inner);
        self.add(w!("STATIC"), &p.text, SS_NOPREFIX, RECT { left, top: y, right: left + inner, bottom: y + bh }, 901, body);
        y += bh + self.px(12);
        let mut first = None;
        for (i, (_, label, on)) in p.ticks.iter().enumerate() {
            let h = self.add(w!("BUTTON"), label, BS_AUTOCHECKBOX as u32 | WS_TABSTOP.0, RECT { left, top: y, right: left + inner, bottom: y + self.px(34) }, 200 + i as i32, strong);
            if *on {
                SendMessageW(h, BM_SETCHECK, WPARAM(BST_CHECKED.0 as usize), LPARAM(0));
            }
            y += self.px(38);
        }
        if p.busy {
            let h = self.add(w!("msctls_progress32"), "Working", PBS_MARQUEE, RECT { left, top: y, right: left + inner, bottom: y + self.px(6) }, 902, body);
            let _ = SetWindowTheme(h, w!(""), w!(""));
            SendMessageW(h, PBM_SETBARCOLOR, WPARAM(0), LPARAM(rgb(ACCENT).0 as isize));
            SendMessageW(h, PBM_SETBKCOLOR, WPARAM(0), LPARAM(rgb(0x2a2a2a).0 as isize));
            SendMessageW(h, PBM_SETMARQUEE, WPARAM(1), LPARAM(20));
            y += self.px(14);
        }
        y += self.px(8);
        self.card.bottom = y;
        y += self.px(18);
        // Main button first, then as many per row as fit.
        let mut x = pad;
        let right = self.px(WIDTH - PAD);
        let h = self.px(42);
        for (i, (label, _)) in p.buttons.iter().enumerate() {
            let t: Vec<u16> = label.encode_utf16().collect();
            let dc = GetDC(self.hwnd);
            let old = SelectObject(dc, strong);
            let mut s = SIZE::default();
            let _ = GetTextExtentPoint32W(dc, &t, &mut s);
            SelectObject(dc, old);
            ReleaseDC(self.hwnd, dc);
            let w = (s.cx + self.px(36)).max(self.px(96));
            if x > pad && x + w > right {
                x = pad;
                y += h + self.px(10);
            }
            let b = self.add(w!("BUTTON"), label, BS_OWNERDRAW as u32 | WS_TABSTOP.0, RECT { left: x, top: y, right: x + w, bottom: y + h }, 100 + i as i32, strong);
            first.get_or_insert(b);
            x += w + self.px(10);
        }
        if !p.buttons.is_empty() {
            y += h;
        }
        y += self.px(22);
        let mut r = RECT { left: 0, top: 0, right: self.px(WIDTH), bottom: y };
        let style = WINDOW_STYLE(GetWindowLongW(self.hwnd, GWL_STYLE) as u32);
        let dpi = GetDpiForWindow(self.hwnd);
        let _ = windows::Win32::UI::HiDpi::AdjustWindowRectExForDpi(&mut r, style, false, WINDOW_EX_STYLE(0), dpi);
        let _ = SetWindowPos(self.hwnd, None, 0, 0, r.right - r.left, r.bottom - r.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
        let _ = InvalidateRect(self.hwnd, None, true);
        let _ = SetFocus(first.unwrap_or(self.hwnd));
    }

    unsafe fn press(&mut self, what: Do) {
        match what {
            Do::Close => { let _ = DestroyWindow(self.hwnd); }
            Do::OpenHelp | Do::AddToChrome => {
                let u = wide(&if what == Do::AddToChrome { install::store_page() } else { install::HELP.into() });
                ShellExecuteW(self.hwnd, w!("open"), pcw(&u), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
            }
            Do::Copy => {
                let done = copy(self.hwnd, &agents::settings_text(&install::exe()));
                self.page.text = if done { "Settings copied. Paste them into your agent's MCP settings, then restart it.".into() } else { "The clipboard is in use. Try again.".into() };
                self.build();
            }
            _ => {
                let ids: Vec<String> = self.page.ticks.iter().enumerate().filter(|(i, _)| {
                    GetDlgItem(self.hwnd, 200 + *i as i32).is_ok_and(|h| SendMessageW(h, BM_GETCHECK, WPARAM(0), LPARAM(0)).0 == BST_CHECKED.0 as isize)
                }).map(|(_, t)| t.0.clone()).collect();
                self.page = working(match what {
                    Do::Install => "Installing",
                    Do::CheckUpdate => "Checking for updates",
                    Do::ApplyUpdate => "Updating",
                    Do::Remove => "Removing",
                    _ => "Working",
                });
                self.build();
                let (tx, release, hwnd) = (self.outbox.clone(), self.release.take(), self.hwnd.0 as usize);
                std::thread::spawn(move || {
                    let _ = tx.send(perform(what, ids, release));
                    let _ = PostMessageW(HWND(hwnd as *mut _), APP_PAGE, WPARAM(0), LPARAM(0));
                });
            }
        }
    }

    unsafe fn paint(&self, dc: HDC) {
        let mut all = RECT::default();
        let _ = GetClientRect(self.hwnd, &mut all);
        FillRect(dc, &all, self.brush);
        let g = Gp::new(dc);
        // logo: gradient square with two overlapping cards
        let (x, y, s) = (self.px(PAD), self.px(24), self.px(44));
        g.round(x, y, s, s, s * 26 / 100, Fill::Neon);
        let c = s * 49 / 100;
        let (a, b) = (s * 15 / 100, s * 36 / 100);
        g.round(x + a, y + a, c, c, s * 13 / 100, Fill::Color(0x69ff_ffff));
        g.round(x + b, y + b, c, c, s * 13 / 100, Fill::Color(0x69ff_ffff));
        g.round(x + b, y + b, a + c - b, a + c - b, s * 10 / 100, Fill::Color(0xffff_ffff));
        let k = self.card;
        g.round(k.left, k.top, k.right - k.left - 1, k.bottom - k.top - 1, self.px(20), Fill::Color(argb(CARD)));
        g.outline(k.left, k.top, k.right - k.left - 1, k.bottom - k.top - 1, self.px(20), argb(0x2e2e2e), 1.0);
        drop(g);
        // two-tone name
        SetBkMode(dc, TRANSPARENT);
        let f = CreateFontW(-self.px(22), 0, 0, 0, 700, 0, 0, 0, DEFAULT_CHARSET.0 as u32, OUT_DEFAULT_PRECIS.0 as u32, CLIP_DEFAULT_PRECIS.0 as u32, CLEARTYPE_QUALITY.0 as u32, 0, w!("Segoe UI"));
        let old = SelectObject(dc, f);
        let mut tx = x + s + self.px(14);
        for (t, c) in [("Shared", FG), ("Tabs", ACCENT)] {
            let u: Vec<u16> = t.encode_utf16().collect();
            SetTextColor(dc, rgb(c));
            let mut m = SIZE::default();
            let _ = GetTextExtentPoint32W(dc, &u, &mut m);
            let _ = TextOutW(dc, tx, y + (s - m.cy) / 2, &u);
            tx += m.cx;
        }
        SelectObject(dc, old);
        let _ = DeleteObject(f);
    }

    unsafe fn draw_button(&self, d: &DRAWITEMSTRUCT) {
        let i = d.CtlID as i32 - 100;
        let main = i == 0 && !matches!(self.page.buttons.first(), Some((_, Do::Remove)));
        let danger = matches!(self.page.buttons.get(i as usize), Some((_, Do::Remove | Do::AskRemove)));
        let down = d.itemState.0 & ODS_SELECTED.0 != 0;
        let focus = d.itemState.0 & ODS_FOCUS.0 != 0;
        let r = d.rcItem;
        let (w, h, rad) = (r.right - r.left, r.bottom - r.top, self.px(12));
        FillRect(d.hDC, &r, self.brush);
        let g = Gp::new(d.hDC);
        if main {
            g.round(1, 1, w - 3, h - 3, rad, Fill::Color(argb(if down { 0x3459d1 } else { SOLID })));
        } else {
            g.round(1, 1, w - 3, h - 3, rad, Fill::Color(argb(if down { 0x1c2233 } else { BG })));
            g.outline(1, 1, w - 3, h - 3, rad, argb(if danger { 0x6b3038 } else { 0x333333 }), 2.0);
        }
        if focus {
            g.outline(if main { 4 } else { 1 }, if main { 4 } else { 1 }, w - if main { 9 } else { 3 }, h - if main { 9 } else { 3 }, rad - if main { 3 } else { 0 }, argb(if main { FG } else { ACCENT }), 2.0);
        }
        drop(g);
        let mut t = vec![0u16; 64];
        let n = GetWindowTextW(d.hwndItem, &mut t) as usize;
        SetBkMode(d.hDC, TRANSPARENT);
        SetTextColor(d.hDC, rgb(if danger { 0xff8a8a } else { FG }));
        let mut r2 = r;
        DrawTextW(d.hDC, &mut t[..n], &mut r2, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }

    unsafe fn draw_tick(&self, d: &NMCUSTOMDRAW) {
        let h = d.hdr.hwndFrom;
        let on = SendMessageW(h, BM_GETCHECK, WPARAM(0), LPARAM(0)).0 == BST_CHECKED.0 as isize;
        let focus = GetFocus() == h;
        let r = d.rc;
        let (w, ht) = (r.right - r.left, r.bottom - r.top);
        let card = CreateSolidBrush(rgb(CARD));
        FillRect(d.hdc, &r, card);
        let _ = DeleteObject(card);
        let g = Gp::new(d.hdc);
        let rad = self.px(10);
        g.round(0, 0, w - 2, ht - 2, rad, Fill::Color(argb(if on { 0x1d2438 } else { 0x1e1e1e })));
        g.outline(1, 1, w - 3, ht - 3, rad, argb(if on || focus { ACCENT } else { 0x2a2a2a }), if focus { 2.5 } else { 1.5 });
        let s = self.px(16);
        let (x, y) = (self.px(12), (ht - s) / 2);
        g.round(x, y, s, s, self.px(5), Fill::Color(argb(if on { SOLID } else { 0x2c2c2c })));
        if on {
            g.tick(x, y, s);
        } else {
            g.outline(x, y, s, s, self.px(5), argb(0x8a8a8a), 1.0);
        }
        drop(g);
        let mut t = vec![0u16; 96];
        let n = GetWindowTextW(h, &mut t) as usize;
        SetBkMode(d.hdc, TRANSPARENT);
        SetTextColor(d.hdc, rgb(FG));
        let mut r2 = RECT { left: x + s + self.px(12), ..r };
        DrawTextW(d.hdc, &mut t[..n], &mut r2, DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    }
}

unsafe fn copy(hwnd: HWND, text: &str) -> bool {
    if OpenClipboard(hwnd).is_err() {
        return false;
    }
    let u = wide(text);
    let mut ok = false;
    let _ = EmptyClipboard();
    if let Ok(m) = GlobalAlloc(GMEM_MOVEABLE, u.len() * 2) {
        let p = GlobalLock(m) as *mut u16;
        if !p.is_null() {
            std::ptr::copy_nonoverlapping(u.as_ptr(), p, u.len());
            let _ = GlobalUnlock(m);
            ok = SetClipboardData(13, HANDLE(m.0)).is_ok(); // CF_UNICODETEXT
        }
    }
    let _ = CloseClipboard();
    ok
}

enum Fill {
    Neon,
    Color(u32),
}
/// The little of GDI+ that is needed for smooth corners.
struct Gp(*mut GpGraphics);
impl Gp {
    unsafe fn new(dc: HDC) -> Gp {
        let mut g = std::ptr::null_mut();
        GdipCreateFromHDC(dc, &mut g);
        GdipSetSmoothingMode(g, SmoothingModeAntiAlias);
        Gp(g)
    }
    unsafe fn path(x: i32, y: i32, w: i32, h: i32, r: i32) -> *mut GpPath {
        let mut p = std::ptr::null_mut();
        GdipCreatePath(FillModeAlternate, &mut p);
        let d = (r * 2).min(w).min(h).max(1);
        GdipAddPathArcI(p, x, y, d, d, 180.0, 90.0);
        GdipAddPathArcI(p, x + w - d, y, d, d, 270.0, 90.0);
        GdipAddPathArcI(p, x + w - d, y + h - d, d, d, 0.0, 90.0);
        GdipAddPathArcI(p, x, y + h - d, d, d, 90.0, 90.0);
        GdipClosePathFigure(p);
        p
    }
    unsafe fn round(&self, x: i32, y: i32, w: i32, h: i32, r: i32, f: Fill) {
        let p = Self::path(x, y, w, h, r);
        match f {
            Fill::Color(c) => {
                let mut b = std::ptr::null_mut();
                GdipCreateSolidFill(c, &mut b);
                GdipFillPath(self.0, b as *mut GpBrush, p);
                GdipDeleteBrush(b as *mut GpBrush);
            }
            Fill::Neon => {
                let mut b = std::ptr::null_mut();
                GdipCreateLineBrushI(&Point { X: x, Y: y }, &Point { X: x + w, Y: y + h }, argb(ACCENT), argb(VIOLET), WrapModeTileFlipXY, &mut b);
                GdipFillPath(self.0, b as *mut GpBrush, p);
                GdipDeleteBrush(b as *mut GpBrush);
            }
        }
        GdipDeletePath(p);
    }
    unsafe fn outline(&self, x: i32, y: i32, w: i32, h: i32, r: i32, c: u32, width: f32) {
        let p = Self::path(x, y, w, h, r);
        let mut pen = std::ptr::null_mut();
        GdipCreatePen1(c, width, UnitPixel, &mut pen);
        GdipDrawPath(self.0, pen, p);
        GdipDeletePen(pen);
        GdipDeletePath(p);
    }
    unsafe fn tick(&self, x: i32, y: i32, s: i32) {
        let mut pen = std::ptr::null_mut();
        GdipCreatePen1(argb(FG), s as f32 / 8.0, UnitPixel, &mut pen);
        let at = |a: i32, b: i32| (x + s * a / 16, y + s * b / 16);
        let (p, q, r) = (at(4, 8), at(7, 11), at(12, 5));
        GdipDrawLineI(self.0, pen, p.0, p.1, q.0, q.1);
        GdipDrawLineI(self.0, pen, q.0, q.1, r.0, r.1);
        GdipDeletePen(pen);
    }
}
impl Drop for Gp {
    fn drop(&mut self) {
        unsafe { GdipDeleteGraphics(self.0); }
    }
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let p = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Window;
    if p.is_null() {
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
    let win = &mut *p;
    match msg {
        APP_PAGE => {
            while let Ok((page, release)) = win.inbox.try_recv() {
                win.page = page;
                win.release = release;
            }
            win.build();
            if win.page.waiting {
                SetTimer(hwnd, WAIT_TIMER, 1000, None);
            }
        }
        WM_COMMAND => {
            let id = (wp.0 & 0xffff) as i32;
            if id == IDCANCEL.0 {
                if !win.page.busy {
                    let _ = DestroyWindow(hwnd);
                }
            } else if let Some((_, what)) = usize::try_from(id - 100).ok().and_then(|i| win.page.buttons.get(i)).copied() {
                if (wp.0 >> 16) as u32 == BN_CLICKED {
                    win.press(what);
                }
            }
        }
        WM_TIMER if wp.0 == WAIT_TIMER => {
            if !win.page.waiting {
                let _ = KillTimer(hwnd, WAIT_TIMER);
            } else if crate::util::chrome_connected() {
                let _ = KillTimer(hwnd, WAIT_TIMER);
                let rest = win.page.text.split_once("Waiting for Chrome...").map(|x| x.1.to_string()).unwrap_or_default();
                win.page = Page { warn: win.page.warn, ..page("Connected", format!("SharedTabs is connected to Chrome. Click its icon there to share a tab and choose which sites agents may use.{rest}"), &[("Done", Do::Close), ("Copy settings for another agent", Do::Copy)]) };
                win.build();
            }
        }
        WM_CLOSE => {
            if !win.page.busy { // an installation in progress finishes first
                let _ = DestroyWindow(hwnd);
            }
        }
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let dc = BeginPaint(hwnd, &mut ps);
            win.paint(dc);
            let _ = EndPaint(hwnd, &ps);
        }
        WM_ERASEBKGND => return LRESULT(1),
        WM_DRAWITEM => {
            win.draw_button(&*(lp.0 as *const DRAWITEMSTRUCT));
            return LRESULT(1);
        }
        WM_NOTIFY => {
            let n = &*(lp.0 as *const NMHDR);
            if n.code == NM_CUSTOMDRAW && (200..300).contains(&n.idFrom) {
                let d = &*(lp.0 as *const NMCUSTOMDRAW);
                if d.dwDrawStage == CDDS_PREERASE || d.dwDrawStage == CDDS_PREPAINT {
                    win.draw_tick(d);
                    return LRESULT(CDRF_SKIPDEFAULT as isize);
                }
            }
        }
        WM_CTLCOLORSTATIC => {
            let dc = HDC(wp.0 as *mut _);
            let id = GetDlgCtrlID(HWND(lp.0 as *mut _));
            SetTextColor(dc, rgb(if id == 900 { FG } else if win.page.warn { WARN } else { MUTED }));
            SetBkColor(dc, rgb(CARD));
            return LRESULT(GetStockObject(DC_BRUSH).0 as isize | { SetDCBrushColor(dc, rgb(CARD)); 0 });
        }
        WM_DPICHANGED => {
            let r = &*(lp.0 as *const RECT);
            let _ = SetWindowPos(hwnd, None, r.left, r.top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            win.build();
        }
        WM_DESTROY => PostQuitMessage(0),
        _ => return DefWindowProcW(hwnd, msg, wp, lp),
    }
    LRESULT(0)
}

#[derive(PartialEq)]
pub enum Start {
    Auto,
    Update,
    Remove,
}

pub fn run(start: Start) {
    unsafe {
        let mut token = 0usize;
        let input = GdiplusStartupInput { GdiplusVersion: 1, ..Default::default() };
        GdiplusStartup(&mut token, &input, std::ptr::null_mut());
        let icc = INITCOMMONCONTROLSEX { dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32, dwICC: ICC_STANDARD_CLASSES | ICC_PROGRESS_CLASS };
        let _ = InitCommonControlsEx(&icc);
        let inst = GetModuleHandleW(None).unwrap_or_default();
        let brush = CreateSolidBrush(rgb(BG));
        let icon = LoadIconW(inst, PCWSTR(1 as *const u16)).unwrap_or_default();
        let class = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: inst.into(), hIcon: icon, hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(), hbrBackground: brush, lpszClassName: w!("SharedTabsWindow"), ..Default::default() };
        RegisterClassW(&class);
        let installed = std::env::current_exe().is_ok_and(|e| e == install::exe());
        let hwnd = CreateWindowExW(WS_EX_CONTROLPARENT, w!("SharedTabsWindow"), w!("SharedTabs Bridge"), WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN, CW_USEDEFAULT, CW_USEDEFAULT, 500, 400, None, None, inst, None);
        let Ok(hwnd) = hwnd else { return };
        let dark = BOOL(1);
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark as *const BOOL as *const _, 4);
        let (outbox, inbox) = channel();
        let page = match start {
            Start::Remove => page("Remove SharedTabs Bridge?", "Agents will no longer be able to use your tabs. Your settings in the Chrome extension are kept.", &[("Remove", Do::Remove), ("Cancel", Do::Close)]),
            _ if installed || start == Start::Update => home_page(),
            _ => setup_page(),
        };
        let win = Box::into_raw(Box::new(Window { hwnd, page, release: None, controls: vec![], fonts: vec![], brush, card: RECT::default(), inbox, outbox }));
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, win as isize);
        (*win).build();
        // centred on the screen it opened on
        let mut r = RECT::default();
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetWindowRect(hwnd, &mut r);
        let _ = GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut mi);
        let a = mi.rcWork;
        let _ = SetWindowPos(hwnd, None, a.left + (a.right - a.left - (r.right - r.left)) / 2, a.top + (a.bottom - a.top - (r.bottom - r.top)) / 3, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
        let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
        let _ = SetForegroundWindow(hwnd);
        if start == Start::Update {
            (*win).press(Do::CheckUpdate);
        }
        let mut m = MSG::default();
        while GetMessageW(&mut m, None, 0, 0).0 > 0 {
            if !IsDialogMessageW(hwnd, &m).as_bool() {
                let _ = TranslateMessage(&m);
                DispatchMessageW(&m);
            }
        }
        let _ = EnableWindow(hwnd, false);
        GdiplusShutdown(token);
    }
}
