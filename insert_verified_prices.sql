-- ============================================================================
-- Add Verified Price columns to PriceHistory + Insert scraped data from NCL.com
-- Run against CruiseTracker database
-- ============================================================================

USE CruiseTracker;
GO

-- ── Step 1: Add verified price columns (idempotent) ──
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('PriceHistory') AND name = 'VerifiedBalconyPrice')
BEGIN
    ALTER TABLE PriceHistory ADD
        VerifiedBalconyPrice   DECIMAL(10,2) NULL,
        VerifiedBalconyPerDay  DECIMAL(10,2) NULL,
        VerifiedSuitePrice     DECIMAL(10,2) NULL,
        VerifiedSuitePerDay    DECIMAL(10,2) NULL,
        VerifiedAt             DATETIME2     NULL;
END
GO

-- ── Step 2: Insert verified NCL Aqua prices (Bermuda from NYC) ──
-- Prices from NCL.com are PER PERSON. Our DB stores TOTAL for 2 guests.
-- So we multiply by 2.

-- First, update the latest PriceHistory row for each sailing that exists
-- NCL Aqua — 7-Day Bermuda (NYC) — scraped Feb 26, 2026

;WITH VerifiedNCLAqua AS (
    SELECT * FROM (VALUES
        ('Norwegian', 'Norwegian Aqua', '2026-04-18', 1349*2, 1349*2/7, 3499*2, 3499*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-04-25', 1249*2, 1249*2/7, 3319*2, 3319*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-05-02', 1299*2, 1299*2/7, 3279*2, 3279*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-05-09', 1309*2, 1309*2/7, 3499*2, 3499*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-05-16', 1519*2, 1519*2/7, 3899*2, 3899*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-05-23', 1499*2, 1499*2/7, 4209*2, 4209*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-05-30', 1429*2, 1429*2/7, 4149*2, 4149*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-06-06', 2029*2, 2029*2/7, 4379*2, 4379*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-06-13', 1929*2, 1929*2/7, 5319*2, 5319*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-06-20', 1849*2, 1849*2/7, 4729*2, 4729*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-07-11', 1879*2, 1879*2/7, 4849*2, 4849*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-07-18', 1889*2, 1889*2/7, 4379*2, 4379*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-07-25', 1749*2, 1749*2/7, 4189*2, 4189*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-08-01', 1699*2, 1699*2/7, 4219*2, 4219*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-08-08', 1649*2, 1649*2/7, 3929*2, 3929*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-08-15', 1569*2, 1569*2/7, 3999*2, 3999*2/7),
        ('Norwegian', 'Norwegian Aqua', '2026-08-22', 1549*2, 1549*2/7, 4159*2, 4159*2/7)
    ) AS t(CruiseLine, ShipName, DepDate, VBalcony, VBalconyPPD, VSuite, VSuitePPD)
)
UPDATE ph SET
    VerifiedBalconyPrice  = v.VBalcony,
    VerifiedBalconyPerDay = v.VBalconyPPD,
    VerifiedSuitePrice    = v.VSuite,
    VerifiedSuitePerDay   = v.VSuitePPD,
    VerifiedAt            = '2026-02-26 21:35:00'
FROM PriceHistory ph
INNER JOIN (
    SELECT CruiseLine, ShipName, DepartureDate, MAX(Id) AS LatestId
    FROM PriceHistory
    GROUP BY CruiseLine, ShipName, DepartureDate
) latest ON ph.Id = latest.LatestId
INNER JOIN VerifiedNCLAqua v
    ON latest.CruiseLine = v.CruiseLine
   AND latest.ShipName = v.ShipName
   AND latest.DepartureDate = CAST(v.DepDate AS DATE);

PRINT 'Updated NCL Aqua verified prices: ' + CAST(@@ROWCOUNT AS VARCHAR);

-- ── NCL Prima — 7-Day Caribbean (Port Canaveral) ──
;WITH VerifiedNCLPrima AS (
    SELECT * FROM (VALUES
        ('Norwegian', 'Norwegian Prima', '2026-04-05', 1199*2, 1199*2/7, 2869*2, 2869*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-04-12', 1199*2, 1199*2/7, 2869*2, 2869*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-04-19', 1279*2, 1279*2/7, 2999*2, 2999*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-04-26', 1229*2, 1229*2/7, 2919*2, 2919*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-05-03', 1349*2, 1349*2/7, 3179*2, 3179*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-05-17', 1679*2, 1679*2/7, 3149*2, 3149*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-05-31', 1479*2, 1479*2/7, 3379*2, 3379*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-06-14', 1419*2, 1419*2/7, 3269*2, 3269*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-06-28', 1609*2, 1609*2/7, 3459*2, 3459*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-07-12', 1559*2, 1559*2/7, 3609*2, 3609*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-07-26', 1609*2, 1609*2/7, 3509*2, 3509*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-08-09', 1509*2, 1509*2/7, 3349*2, 3349*2/7),
        ('Norwegian', 'Norwegian Prima', '2026-08-23', 1379*2, 1379*2/7, 3449*2, 3449*2/7)
    ) AS t(CruiseLine, ShipName, DepDate, VBalcony, VBalconyPPD, VSuite, VSuitePPD)
)
UPDATE ph SET
    VerifiedBalconyPrice  = v.VBalcony,
    VerifiedBalconyPerDay = v.VBalconyPPD,
    VerifiedSuitePrice    = v.VSuite,
    VerifiedSuitePerDay   = v.VSuitePPD,
    VerifiedAt            = '2026-02-26 21:35:00'
FROM PriceHistory ph
INNER JOIN (
    SELECT CruiseLine, ShipName, DepartureDate, MAX(Id) AS LatestId
    FROM PriceHistory
    GROUP BY CruiseLine, ShipName, DepartureDate
) latest ON ph.Id = latest.LatestId
INNER JOIN VerifiedNCLPrima v
    ON latest.CruiseLine = v.CruiseLine
   AND latest.ShipName = v.ShipName
   AND latest.DepartureDate = CAST(v.DepDate AS DATE);

PRINT 'Updated NCL Prima verified prices: ' + CAST(@@ROWCOUNT AS VARCHAR);

-- ── NCL Encore — 7-Day Caribbean (Miami) ──
;WITH VerifiedNCLEncore AS (
    SELECT * FROM (VALUES
        ('Norwegian', 'Norwegian Encore', '2026-03-21', 899*2, 899*2/7, 2699*2, 2699*2/7),
        ('Norwegian', 'Norwegian Encore', '2026-03-28', 1029*2, 1029*2/7, 2949*2, 2949*2/7)
    ) AS t(CruiseLine, ShipName, DepDate, VBalcony, VBalconyPPD, VSuite, VSuitePPD)
)
UPDATE ph SET
    VerifiedBalconyPrice  = v.VBalcony,
    VerifiedBalconyPerDay = v.VBalconyPPD,
    VerifiedSuitePrice    = v.VSuite,
    VerifiedSuitePerDay   = v.VSuitePPD,
    VerifiedAt            = '2026-02-26 21:35:00'
FROM PriceHistory ph
INNER JOIN (
    SELECT CruiseLine, ShipName, DepartureDate, MAX(Id) AS LatestId
    FROM PriceHistory
    GROUP BY CruiseLine, ShipName, DepartureDate
) latest ON ph.Id = latest.LatestId
INNER JOIN VerifiedNCLEncore v
    ON latest.CruiseLine = v.CruiseLine
   AND latest.ShipName = v.ShipName
   AND latest.DepartureDate = CAST(v.DepDate AS DATE);

PRINT 'Updated NCL Encore verified prices: ' + CAST(@@ROWCOUNT AS VARCHAR);

-- ── NCL Getaway — 7-Day Caribbean (Port Canaveral) ──
;WITH VerifiedNCLGetaway AS (
    SELECT * FROM (VALUES
        ('Norwegian', 'Norwegian Getaway', '2026-11-16', 1319*2, 1319*2/7, 3339*2, 3339*2/7)
    ) AS t(CruiseLine, ShipName, DepDate, VBalcony, VBalconyPPD, VSuite, VSuitePPD)
)
UPDATE ph SET
    VerifiedBalconyPrice  = v.VBalcony,
    VerifiedBalconyPerDay = v.VBalconyPPD,
    VerifiedSuitePrice    = v.VSuite,
    VerifiedSuitePerDay   = v.VSuitePPD,
    VerifiedAt            = '2026-02-26 21:35:00'
FROM PriceHistory ph
INNER JOIN (
    SELECT CruiseLine, ShipName, DepartureDate, MAX(Id) AS LatestId
    FROM PriceHistory
    GROUP BY CruiseLine, ShipName, DepartureDate
) latest ON ph.Id = latest.LatestId
INNER JOIN VerifiedNCLGetaway v
    ON latest.CruiseLine = v.CruiseLine
   AND latest.ShipName = v.ShipName
   AND latest.DepartureDate = CAST(v.DepDate AS DATE);

PRINT 'Updated NCL Getaway verified prices: ' + CAST(@@ROWCOUNT AS VARCHAR);

-- ── Step 3: Insert verified Disney FL Resident prices ──
-- Disney prices from the website are TOTAL for 2 guests already (not per person)
-- Verandah = Balcony equivalent, Concierge = Suite equivalent

-- Disney Fantasy
;WITH VerifiedDisney AS (
    SELECT * FROM (VALUES
        -- Ship, DepDate, Nights, Verandah(total), Concierge(total)
        ('Disney', 'Disney Fantasy', '2026-03-25', 4, 2405, NULL),
        ('Disney', 'Disney Fantasy', '2026-04-22', 4, 2237, NULL),
        ('Disney', 'Disney Fantasy', '2026-04-12', 5, 2887, NULL),
        ('Disney', 'Disney Fantasy', '2026-05-10', 5, 3322, NULL),
        ('Disney', 'Disney Wish',    '2026-03-16', 4, 2960, 5280),
        ('Disney', 'Disney Wish',    '2026-03-27', 3, 2246, NULL),
        ('Disney', 'Disney Wish',    '2026-04-27', 4, 2880, NULL),
        ('Disney', 'Disney Wish',    '2026-05-11', 4, 2960, NULL),
        ('Disney', 'Disney Dream',   '2026-03-02', 4, NULL,  NULL),  -- only Inside/OV available
        ('Disney', 'Disney Dream',   '2026-03-23', 4, 2810, NULL),
        ('Disney', 'Disney Dream',   '2026-05-02', 14, 4276, NULL),
        ('Disney', 'Disney Treasure','2026-03-21', 7, 4312, NULL),
        ('Disney', 'Disney Treasure','2026-04-18', 7, 4830, NULL),
        ('Disney', 'Disney Treasure','2026-05-02', 7, 4264, NULL),
        ('Disney', 'Disney Treasure','2026-05-30', 7, 5104, NULL)
    ) AS t(CruiseLine, ShipName, DepDate, Nights, FLVerandah, FLConcierge)
)
UPDATE ph SET
    -- Store FL Resident verified Verandah as FLResBalcony, Concierge as FLResSuite
    FLResBalconyPrice  = v.FLVerandah,
    FLResBalconyPerDay = CASE WHEN v.FLVerandah IS NOT NULL THEN CAST(v.FLVerandah * 1.0 / v.Nights AS DECIMAL(10,2)) END,
    FLResSuitePrice    = v.FLConcierge,
    FLResSuitePerDay   = CASE WHEN v.FLConcierge IS NOT NULL THEN CAST(v.FLConcierge * 1.0 / v.Nights AS DECIMAL(10,2)) END,
    VerifiedAt         = '2026-02-26 21:35:00'
FROM PriceHistory ph
INNER JOIN (
    SELECT CruiseLine, ShipName, DepartureDate, MAX(Id) AS LatestId
    FROM PriceHistory
    GROUP BY CruiseLine, ShipName, DepartureDate
) latest ON ph.Id = latest.LatestId
INNER JOIN VerifiedDisney v
    ON latest.CruiseLine = v.CruiseLine
   AND latest.ShipName = v.ShipName
   AND latest.DepartureDate = CAST(v.DepDate AS DATE)
WHERE v.FLVerandah IS NOT NULL OR v.FLConcierge IS NOT NULL;

PRINT 'Updated Disney FL Resident verified prices: ' + CAST(@@ROWCOUNT AS VARCHAR);

-- ── Step 4: Quick verification query ──
SELECT 
    ph.CruiseLine, ph.ShipName, ph.DepartureDate,
    ph.BalconyPrice AS CruiseCom_Balcony,
    ph.VerifiedBalconyPrice AS Verified_Balcony,
    CASE WHEN ph.VerifiedBalconyPrice > 0 AND ph.BalconyPrice > 0 
         THEN CAST((ph.VerifiedBalconyPrice - ph.BalconyPrice) * 100.0 / ph.BalconyPrice AS DECIMAL(5,1))
    END AS Balcony_Diff_Pct,
    ph.SuitePrice AS CruiseCom_Suite,
    ph.VerifiedSuitePrice AS Verified_Suite,
    ph.FLResBalconyPrice AS FL_Verandah,
    ph.VerifiedAt
FROM PriceHistory ph
WHERE ph.VerifiedAt IS NOT NULL
ORDER BY ph.CruiseLine, ph.ShipName, ph.DepartureDate;
