param([ValidateSet('voices', 'synthesize')][string]$Action = 'voices')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
        [pscustomobject]@{
            id = $_.VoiceInfo.Id
            name = $_.VoiceInfo.Name
            gender = $_.VoiceInfo.Gender.ToString().ToLowerInvariant()
            language = $_.VoiceInfo.Culture.Name
            description = $_.VoiceInfo.Description
            engineVersion = [System.Speech.Synthesis.SpeechSynthesizer].Assembly.GetName().Version.ToString()
        }
    })
    if ($Action -eq 'voices') {
        ConvertTo-Json -InputObject $voices -Compress -Depth 5
        exit 0
    }
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $voice = @($voices | Where-Object { $_.id -eq $request.voiceId })
    if ($voice.Count -ne 1) { throw 'Requested installed voice is unavailable or ambiguous.' }
    if ([string]::IsNullOrWhiteSpace($request.text)) { throw 'Speech text is empty.' }
    if ($request.text.Length -gt 5000) { throw 'Speech segment exceeds 5000 characters.' }
    $synth.SelectVoice($voice[0].name)
    $synth.Rate = [int]$request.rate
    $synth.Volume = 100
    $synth.SetOutputToWaveFile([IO.Path]::GetFullPath($request.outputPath))
    # Speak treats input as plain text. No user-supplied SSML, commands or code.
    $synth.Speak([string]$request.text)
    $synth.SetOutputToNull()
    @{status='passed'; voiceId=$synth.Voice.Id} | ConvertTo-Json -Compress
}
catch {
    # Do not print submitted text, paths or PowerShell command expansion.
    [Console]::Error.WriteLine('Windows local TTS failed: ' + $_.Exception.GetType().Name)
    exit 1
}
finally {
    $synth.Dispose()
}
