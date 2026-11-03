#Requires -Version 7.2
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
  [string]$ImportId,
  [switch]$RetryAttention,
  [ValidateRange(1, 20)]
  [int]$MaxInvocations = 12
)

# Explicit operator pilot, not a scheduler or a replacement for browser retry.
# Requires CLI administrator access and this Windows user's DPAPI-protected key.
# Never prints secrets, source text, personal data or raw provider diagnostics.
$ErrorActionPreference = 'Stop'
$csBackend = Split-Path -Parent $PSScriptRoot
Push-Location $csBackend
try {
  $csProject = (Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim()
  if ($csProject -ne 'lovqyhwwsettprenfrrq') { throw 'Unexpected linked pilot project.' }
  $csCliPackage = & node -p "require.resolve('@supabase/cli-windows-x64/package.json')"
  if ($LASTEXITCODE -ne 0) { throw 'Supabase CLI is unavailable.' }
  $csCli = Join-Path (Split-Path -Parent $csCliPackage) 'bin/supabase.exe'
  function Invoke-CsPilotSql([string]$Query) {
    $csSqlOutput = & $csCli db query --linked --output-format json ($Query -replace '[\r\n]+', ' ')
    if ($LASTEXITCODE -ne 0) { throw 'The pilot database operation was not confirmed.' }
    return @(($csSqlOutput | Out-String | ConvertFrom-Json).rows)
  }
  function Read-CsPilotState {
    $csRows = @(Invoke-CsPilotSql "select id,updated_at,status,source_status,request_id,error_code,attempt_count,worker_failure_count,next_attempt_at,worker_token is not null as worker_reserved, jsonb_array_length(attachment_refs) as attachment_count,(select jsonb_agg(jsonb_build_object('kind',s ->> 'kind','status',s ->> 'status','model',s ->> 'model','error',s -> 'error')) from jsonb_array_elements(worker_checkpoint -> 'sources') s) as source_results from valtrim.service_request_imports where id = '$ImportId'::uuid")
    if ($csRows.Count -ne 1) { throw 'Exactly one pilot import must exist.' }
    return $csRows[0]
  }
  $csEncrypted = Get-Content -LiteralPath 'supabase/.temp/customer-service-email-worker-secret.dpapi' -Raw
  $csSecure = ConvertTo-SecureString $csEncrypted
  $csKey = [System.Net.NetworkCredential]::new('', $csSecure).Password
  $csMetadataOutput = & $csCli secrets list --project-ref $csProject --output json
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify the worker key metadata.' }
  $csMetadata = @($csMetadataOutput | Out-String | ConvertFrom-Json)
  $csDigest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($csKey))).ToLowerInvariant()
  if (@($csMetadata | Where-Object { $_.name -eq 'CUSTOMER_SERVICE_EMAIL_WORKER_SECRET' -and $_.value -eq $csDigest }).Count -ne 1) {
    throw 'The encrypted worker key does not match the configured secret.'
  }
  $csState = Read-CsPilotState
  if ($RetryAttention) {
    # A human explicitly authorizes this administrator operation. Keep original
    # identity, immutable files, checkpoints, attempts and failure budgets intact.
    # The version and row lock prevent overwriting a concurrent human/worker.
    $csVersion = ([string]$csState.updated_at).Replace("'", "''")
    $csRetrySql = @"
with candidate as materialized (
  select * from valtrim.service_request_imports
  where id = '$ImportId'::uuid and updated_at = '$csVersion'::timestamptz
    and source_status = 'AVAILABLE' and status = 'NEEDS_ATTENTION'
    and error_code in ('ANALYSIS_FAILED','WORKER_ERROR') and request_id is null
    and worker_token is null and worker_failure_count < 3
    and (next_attempt_at is null or next_attempt_at <= clock_timestamp()) for update
), queued as (
  update valtrim.service_request_imports i set status = 'PENDING',error_code = null,error_message = null
  from candidate c where i.id = c.id returning i.id,c.status as previous_status,
    c.error_code as previous_error_code,c.error_message as previous_error_message
), audited as (
  insert into valtrim.audit_events(module,action,actor_type,actor_name,entity_type,entity_id,summary,previous_values,metadata)
  select 'CUSTOMER_SERVICE','SERVICE_EMAIL_PILOT_RETRY','SYSTEM','Customer Service pilot operator',
    'SERVICE_REQUEST_IMPORT',id::text,'Explicitly authorized block 3 pilot retry.',
    jsonb_build_object('status',previous_status,'errorCode',previous_error_code,'errorMessage',previous_error_message),
    jsonb_build_object('importId',id,'stage','BLOCK_3','preservesCheckpoints',true,'preservesFailureBudget',true)
  from queued returning id
)
select (select count(*) from queued) = 1 as queued,(select count(*) from audited) as audit_count
"@
    $csQueueRows = @(Invoke-CsPilotSql $csRetrySql)
    if ($csQueueRows.Count -ne 1 -or -not $csQueueRows[0].queued -or $csQueueRows[0].audit_count -ne 1) {
      throw 'The import changed or cannot be retried; no retry was queued.'
    }
    @{ stage = 'PILOT_RETRY_AUTHORIZED'; importId = $ImportId } | ConvertTo-Json -Compress
  }
  $csHeaders = @{ 'x-valtrim-email-worker-secret' = $csKey }
  $csBody = @{ importId = $ImportId } | ConvertTo-Json -Compress
  $csEndpoint = 'https://' + $csProject + '.supabase.co/functions/v1/customer-service-email-worker'
  for ($csRun = 1; $csRun -le $MaxInvocations; $csRun++) {
    try {
      $csHttp = Invoke-WebRequest -Uri $csEndpoint -Method Post -Headers $csHeaders -ContentType 'application/json' -Body $csBody -TimeoutSec 145 -SkipHttpErrorCheck
      $csResult = $csHttp.Content | ConvertFrom-Json
    } catch { throw 'Worker response unconfirmed; inspect the receipt before repeating.' }
    @{ stage = 'WORKER_RESULT'; run = $csRun; httpStatus = [int]$csHttp.StatusCode; status = $csResult.status;
      importId = $csResult.importId; requestId = $csResult.requestId; nextAttemptAt = $csResult.nextAttemptAt;
      errorCode = $csResult.errorCode; error = $csResult.error } | ConvertTo-Json -Compress
    if ([int]$csHttp.StatusCode -ne 200) { break }
    if ($csResult.status -eq 'PROCESSED' -and $null -ne $csResult.requestId) {
      $csReplayHttp = Invoke-WebRequest -Uri $csEndpoint -Method Post -Headers $csHeaders -ContentType 'application/json' -Body $csBody -TimeoutSec 30 -SkipHttpErrorCheck
      $csReplay = $csReplayHttp.Content | ConvertFrom-Json
      @{ stage = 'WORKER_REPLAY'; status = $csReplay.status; sameRequest = ($csReplay.requestId -eq $csResult.requestId);
        requestId = $csReplay.requestId; idempotentReplay = $csReplay.idempotentReplay } | ConvertTo-Json -Compress
      if ([int]$csReplayHttp.StatusCode -ne 200 -or $csReplay.requestId -ne $csResult.requestId) { throw 'Replay did not confirm the same request.' }
      break
    }
    if ($csResult.status -ne 'PENDING') { break }
    $csWait = if ($csResult.nextAttemptAt) {
      [Math]::Max(1, [Math]::Ceiling(([DateTimeOffset]::Parse($csResult.nextAttemptAt) - [DateTimeOffset]::UtcNow).TotalSeconds))
    } else { 1 }
    if ($csWait -gt 310) { break }
    while ($csWait -gt 0) { $csSleep = [Math]::Min(20, $csWait); Start-Sleep -Seconds $csSleep; $csWait -= $csSleep }
  }
  Read-CsPilotState | ConvertTo-Json -Depth 7 -Compress
} finally {
  if ($csHeaders) { $csHeaders.Clear() }
  $csKey = $null
  if ($csSecure) { $csSecure.Dispose() }
  Pop-Location
}
