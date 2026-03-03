-- ================================================================
-- CruiseTracker Database Schema
-- SQL Server: STEVEOFFICEPC\ORACLE2SQL, Database: CruiseTracker
-- Generated: 2026-03-03
-- ================================================================

-- ── Cruises ─────────────────────────────────────────────────────
-- One row per sailing (cruise line + ship + departure date = PK)

CREATE TABLE Cruises (
    CruiseLine       NVARCHAR(100)  NOT NULL,
    ShipName         NVARCHAR(200)  NOT NULL,
    DepartureDate    DATE           NOT NULL,
    Itinerary        NVARCHAR(500)  NULL,
    Nights           INT            NULL,
    DeparturePort    NVARCHAR(200)  NULL,
    Ports            NVARCHAR(1000) NULL,
    CreatedAt        DATETIME2      NOT NULL DEFAULT GETDATE(),
    IsDeparted       BIT            NOT NULL DEFAULT 0,
    ItineraryCode    NVARCHAR(100)  NULL,

    CONSTRAINT PK_Cruises PRIMARY KEY (CruiseLine, ShipName, DepartureDate)
);

-- ── PriceHistory ────────────────────────────────────────────────
-- Price snapshots per scraper run. Multiple rows per sailing over time.

CREATE TABLE PriceHistory (
    Id                          INT            IDENTITY(1,1) PRIMARY KEY,
    CruiseLine                  NVARCHAR(100)  NOT NULL,
    ShipName                    NVARCHAR(200)  NOT NULL,
    DepartureDate               DATE           NOT NULL,
    InsidePrice                 DECIMAL(18,2)  NULL,
    InsidePerDay                DECIMAL(18,2)  NULL,
    OceanviewPrice              DECIMAL(18,2)  NULL,
    OceanviewPerDay             DECIMAL(18,2)  NULL,
    BalconyPrice                DECIMAL(18,2)  NULL,
    BalconyPerDay               DECIMAL(18,2)  NULL,
    SuitePrice                  DECIMAL(18,2)  NULL,
    SuitePerDay                 DECIMAL(18,2)  NULL,
    ScrapedAt                   DATETIME2      NOT NULL,
    FLResBalconyPrice           DECIMAL(18,2)  NULL,
    FLResBalconyPerDay          DECIMAL(18,2)  NULL,
    FLResSuitePrice             DECIMAL(18,2)  NULL,
    FLResSuitePerDay            DECIMAL(18,2)  NULL,
    VerifiedBalconyPrice        DECIMAL(18,2)  NULL,
    VerifiedBalconyPerDay       DECIMAL(18,2)  NULL,
    VerifiedSuitePrice          DECIMAL(18,2)  NULL,
    VerifiedSuitePerDay         DECIMAL(18,2)  NULL,
    VerifiedAt                  DATETIME2      NULL,
    FamilyInsidePrice           DECIMAL(18,2)  NULL,
    FamilyInsidePerDay          DECIMAL(18,2)  NULL,
    FamilyOceanviewPrice        DECIMAL(18,2)  NULL,
    FamilyOceanviewPerDay       DECIMAL(18,2)  NULL,
    FamilyBalconyPrice          DECIMAL(18,2)  NULL,
    FamilyBalconyPerDay         DECIMAL(18,2)  NULL,
    FamilySuitePrice            DECIMAL(18,2)  NULL,
    FamilySuitePerDay           DECIMAL(18,2)  NULL,
    FamilyVerifiedSuitePrice    DECIMAL(18,2)  NULL,
    FamilyVerifiedSuitePerDay   DECIMAL(18,2)  NULL
);

-- Index for fast lookups by sailing + scrape time
CREATE NONCLUSTERED INDEX IX_PriceHistory_Sailing
    ON PriceHistory (CruiseLine, ShipName, DepartureDate, ScrapedAt);

-- ── Restaurants ─────────────────────────────────────────────────
-- Restaurant data per ship, with hand-scored ratings

CREATE TABLE Restaurants (
    Id        INT            IDENTITY(1,1) PRIMARY KEY,
    ShipName  NVARCHAR(100)  NOT NULL,
    Name      NVARCHAR(200)  NOT NULL,
    Type      NVARCHAR(50)   NOT NULL,   -- 'Included', 'Specialty/Paid', 'Suite-Exclusive'
    Cuisine   NVARCHAR(100)  NOT NULL,
    Score     INT            NOT NULL,    -- 0-100
    Why       NVARCHAR(MAX)  NOT NULL DEFAULT ''
);

-- ── ScraperRuns ─────────────────────────────────────────────────
-- Execution log for each scraper run

CREATE TABLE ScraperRuns (
    Id               INT            IDENTITY(1,1) PRIMARY KEY,
    ScraperName      NVARCHAR(50)   NOT NULL,
    StartedAt        DATETIME2      NOT NULL,
    CompletedAt      DATETIME2      NOT NULL,
    SailingsFound    INT            NOT NULL,
    SailingsUpdated  INT            NOT NULL,
    Errors           NVARCHAR(MAX)  NULL,
    Status           NVARCHAR(20)   NOT NULL   -- 'success', 'error'
);
