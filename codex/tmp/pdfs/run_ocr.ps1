$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await($op, [Type]$resultType) { $m=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1} | Select-Object -First 1; $task=$m.MakeGenericMethod($resultType).Invoke($null,@($op)); $task.GetAwaiter().GetResult() }
$files=Get-ChildItem 'tmp/pdfs/seja_assertivo_pages' -Filter 'p-*.jpg' | Sort-Object Name
$engine=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]::TryCreateFromLanguage([Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]::new('pt-BR'))
$all=[System.Collections.Generic.List[object]]::new(); $i=0
foreach($f in $files) {
 $bytes=[IO.File]::ReadAllBytes($f.FullName); $s=[Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage,ContentType=WindowsRuntime]::new()
 $w=[Windows.Storage.Streams.DataWriter,Windows.Storage,ContentType=WindowsRuntime]::new($s); $w.WriteBytes($bytes); [void](Await ($w.StoreAsync()) ([uint32])); $w.DetachStream() | Out-Null; $s.Seek(0)
 $d=Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime])
 $b=Await ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime])
 $r=Await ($engine.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime])
 $ls=@(); foreach($line in $r.Lines) { $ls += [string]$line.Text }
 $all.Add([pscustomobject]@{page=++$i; lines=$ls})
 if($i % 30 -eq 0) { Write-Output "OCR $i/$($files.Count)" }
}
$json=ConvertTo-Json -InputObject @($all) -Depth 6
[IO.File]::WriteAllText('tmp/pdfs/ocr-pages.json',$json,[Text.UTF8Encoding]::new($false))
Write-Output "OCR complete $i pages"
