param(
  [string]$TaskName = 'Local Automation Server'
)

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Write-Output "NOT_INSTALLED $TaskName"
  exit 1
}

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Output ("{0} {1} LastRun={2} LastResult={3}" -f $task.State, $TaskName, $info.LastRunTime, $info.LastTaskResult)
