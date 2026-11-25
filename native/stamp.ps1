# Adds the icon, version details and manifest to a built exe.
param([string]$Exe, [string]$Version, [string]$IconDir, [string]$Manifest)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Res {
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr BeginUpdateResource(string f, bool del);
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, int len);
  [DllImport("kernel32", SetLastError=true)] public static extern bool EndUpdateResource(IntPtr h, bool discard);
}
'@
function Bytes16([string]$s) { [Text.Encoding]::Unicode.GetBytes($s) }
function Block([string]$key, [byte[]]$value, [int]$valueLen, [int]$type, [byte[]]$children) {
  $m = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $m
  $w.Write([uint16]0); $w.Write([uint16]$valueLen); $w.Write([uint16]$type); $w.Write([byte[]](Bytes16 ($key + [char]0)))
  while ($m.Length % 4) { $w.Write([byte]0) }
  if ($value) { $w.Write($value) }
  while ($m.Length % 4) { $w.Write([byte]0) }
  if ($children) { $w.Write($children) }
  $b = $m.ToArray(); [BitConverter]::GetBytes([uint16]$b.Length).CopyTo($b, 0)
  $pad = (4 - $b.Length % 4) % 4; if ($pad) { $b += (New-Object byte[] $pad) }
  , $b
}
function Str([string]$k, [string]$v) { , (Block $k (Bytes16 ($v + [char]0)) ($v.Length + 1) 1 $null) }
$v = $Version.Split('.') | ForEach-Object { [uint16]$_ }
$ms = ([uint32]$v[0] -shl 16) -bor $v[1]; $ls = [uint32]$v[2] -shl 16
$fixed = New-Object IO.MemoryStream; $fw = New-Object IO.BinaryWriter $fixed
foreach ($n in @(4277077181, 0x10000, $ms, $ls, $ms, $ls, 0x3f, 0, 0x40004, 1, 0, 0, 0)) { $fw.Write([uint32]$n) }
$strings = [byte[]]@()
foreach ($p in @(@('CompanyName', 'SharedTabs'), @('FileDescription', 'SharedTabs Bridge'), @('FileVersion', $Version), @('InternalName', 'sharedtabs'), @('OriginalFilename', 'sharedtabs.exe'), @('ProductName', 'SharedTabs Bridge'), @('ProductVersion', $Version))) { $strings += (Str $p[0] $p[1]) }
$table = Block '040904b0' $null 0 1 $strings
$sfi = Block 'StringFileInfo' $null 0 1 $table
$var = Block 'Translation' ([byte[]](9, 4, 0xb0, 4)) 4 0 $null
$vfi = Block 'VarFileInfo' $null 0 1 $var
$info = Block 'VS_VERSION_INFO' $fixed.ToArray() 52 0 ([byte[]]($sfi + $vfi))

$h = [Res]::BeginUpdateResource($Exe, $false)
if ($h -eq [IntPtr]::Zero) { throw 'BeginUpdateResource failed' }
function Put([int]$type, [int]$id, [byte[]]$d, [int]$lang = 1033) { if (-not [Res]::UpdateResource($h, [IntPtr]$type, [IntPtr]$id, $lang, $d, $d.Length)) { throw "resource $type failed" } }
$g = New-Object IO.MemoryStream; $gw = New-Object IO.BinaryWriter $g
$sizes = 16, 24, 32, 48, 256
$gw.Write([uint16]0); $gw.Write([uint16]1); $gw.Write([uint16]$sizes.Count)
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $d = [IO.File]::ReadAllBytes((Join-Path $IconDir "$($sizes[$i]).png"))
  Put 3 ($i + 1) $d
  $s = [byte]($sizes[$i] % 256)
  $gw.Write($s); $gw.Write($s); $gw.Write([byte]0); $gw.Write([byte]0); $gw.Write([uint16]1); $gw.Write([uint16]32); $gw.Write([uint32]$d.Length); $gw.Write([uint16]($i + 1))
}
Put 14 1 $g.ToArray()
Put 16 1 $info
Put 24 1 ([IO.File]::ReadAllBytes($Manifest))
if (-not [Res]::EndUpdateResource($h, $false)) { throw 'EndUpdateResource failed' }
