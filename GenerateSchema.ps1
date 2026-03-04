# ═══════════════════════════════════════════════════════════════════════
# GenerateSchema.ps1 — Auto-generate db/SCHEMA.md from live database
#
# Queries INFORMATION_SCHEMA to produce an AI-friendly markdown file
# describing all tables, columns, types, indexes, and row counts.
# Run standalone or called automatically from Deploy.ps1.
#
# Output: c:\Dev\Cruise Tracker\db\SCHEMA.md
# ═══════════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
$server = 'STEVEOFFICEPC\ORACLE2SQL'
$database = 'CruiseTracker'
$outFile = 'c:\Dev\Cruise Tracker\db\SCHEMA.md'

# Use sqlcmd to query INFORMATION_SCHEMA
function Run-Query([string]$sql) {
    $result = & sqlcmd -S $server -d $database -Q $sql -h -1 -W -s "|" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "sqlcmd failed: $result"
        return @()
    }
    # Force array of strings, filter empties
    $lines = @($result) | ForEach-Object { [string]$_ } | Where-Object { $_.Trim() -and $_ -notmatch '^\-+' -and $_ -notmatch 'rows affected' }
    return @($lines)
}

$timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')

# Get all tables
$tables = Run-Query "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"

$md = @()
$md += "# CruiseTracker Database Schema"
$md += ""
$md += "> Auto-generated from live database on $timestamp"
$md += "> Server: ``$server`` | Database: ``$database``"
$md += ""

# Table of contents
$md += "## Tables"
$md += ""
foreach ($t in $tables) {
    $tableName = $t.Trim()
    if ($tableName) {
        $md += "- [$tableName](#$($tableName.ToLower()))"
    }
}
$md += ""
$md += "---"
$md += ""

foreach ($t in $tables) {
    $tableName = $t.Trim()
    if (-not $tableName) { continue }
    
    # Row count
    $countResult = Run-Query "SELECT COUNT(*) FROM [$tableName]"
    $rowCount = if ($countResult) { ($countResult | Select-Object -First 1).Trim() } else { "?" }
    
    $md += "## $tableName"
    $md += ""
    $md += "**Rows:** $rowCount"
    $md += ""
    
    # Columns
    $cols = Run-Query @"
SELECT c.COLUMN_NAME, c.DATA_TYPE, 
       CASE WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN CAST(c.CHARACTER_MAXIMUM_LENGTH AS VARCHAR) ELSE '' END,
       c.IS_NULLABLE,
       ISNULL(c.COLUMN_DEFAULT, '')
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = '$tableName'
ORDER BY c.ORDINAL_POSITION
"@
    
    $md += "| Column | Type | Nullable | Default |"
    $md += "|--------|------|----------|---------|"
    
    foreach ($col in $cols) {
        $parts = $col -split '\|'
        if ($parts.Count -ge 4) {
            $colName = $parts[0].Trim()
            $dataType = $parts[1].Trim()
            $maxLen = $parts[2].Trim()
            $nullable = if ($parts[3].Trim() -eq 'YES') { '✓' } else { '' }
            $default = $parts[4].Trim() -replace '^\(+|\)+$', ''
            
            $typeStr = if ($maxLen -and $maxLen -ne '-1') { "$dataType($maxLen)" } elseif ($maxLen -eq '-1') { "$dataType(MAX)" } else { $dataType }
            
            $md += "| ``$colName`` | $typeStr | $nullable | $default |"
        }
    }
    $md += ""
    
    # Primary key
    $pk = Run-Query @"
SELECT STRING_AGG(cu.COLUMN_NAME, ', ') WITHIN GROUP (ORDER BY cu.ORDINAL_POSITION)
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE cu ON tc.CONSTRAINT_NAME = cu.CONSTRAINT_NAME
WHERE tc.TABLE_NAME = '$tableName' AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
"@
    $pkStr = ($pk -join '').Trim()
    if ($pkStr) {
        $md += "**Primary Key:** ``$pkStr``"
        $md += ""
    }
    
    # Indexes
    $indexes = Run-Query @"
SELECT i.name, STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.object_id = OBJECT_ID('$tableName') AND i.is_primary_key = 0 AND i.name IS NOT NULL
GROUP BY i.name
"@
    if ($indexes) {
        $md += "**Indexes:**"
        foreach ($idx in $indexes) {
            $idxParts = $idx -split '\|'
            if ($idxParts.Count -ge 2) {
                $md += "- ``$($idxParts[0].Trim())`` on ($($idxParts[1].Trim()))"
            }
        }
        $md += ""
    }
    
    $md += "---"
    $md += ""
}

# Write file
$md -join "`r`n" | Set-Content -Path $outFile -Encoding UTF8
Write-Host "Schema written to $outFile ($($md.Count) lines)"
