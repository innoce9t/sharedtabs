// Node cannot set a security descriptor on a named pipe, so a short PowerShell step replaces it:
// full control for the current user, network logons denied, nobody else listed.
import { spawn } from 'node:child_process';
import path from 'node:path';

const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$rights = [IO.Pipes.PipeAccessRights]'ReadWrite, ReadPermissions, ChangePermissions'
$p = New-Object IO.Pipes.NamedPipeClientStream('.', $env:HERMES_PIPE, $rights, [IO.Pipes.PipeOptions]::None, [Security.Principal.TokenImpersonationLevel]::Anonymous, [IO.HandleInheritability]::None)
$p.Connect(5000)
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User
$net = New-Object Security.Principal.SecurityIdentifier('S-1-5-2')
$sec = New-Object IO.Pipes.PipeSecurity
$sec.SetAccessRuleProtection($true, $false)
$sec.AddAccessRule((New-Object IO.Pipes.PipeAccessRule($net, [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Deny)))
$sec.AddAccessRule((New-Object IO.Pipes.PipeAccessRule($me, [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)))
$p.SetAccessControl($sec)
$check = @($p.GetAccessControl().GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.AccessControlType -eq 'Allow' })
if ($check.Count -ne 1 -or $check[0].IdentityReference.Value -ne $me.Value) { throw 'The access list was not applied' }
[Console]::Out.Write('LOCKED')
`;

export function lockPipeToCurrentUser(pipe) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      env: { ...process.env, HERMES_PIPE: pipe.replace('\\\\.\\pipe\\', '') },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 20000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      if (out.trim() === 'LOCKED') resolve();
      else reject(new Error((err || out || 'PowerShell did not finish').slice(0, 400)));
    });
  });
}
