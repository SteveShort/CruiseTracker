# CruiseTracker Database Schema

> Auto-generated from live database on 2026-03-05 18:06
> Server: `STEVEOFFICEPC\ORACLE2SQL` | Database: `CruiseTracker`

## Tables

- [Cruises](#cruises)
- [PriceHistory](#pricehistory)
- [Restaurants](#restaurants)
- [ScraperRuns](#scraperruns)

---

## Cruises

**Rows:** 7313

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `CruiseLine` | nvarchar(100) |  |  |
| `ShipName` | nvarchar(200) |  |  |
| `DepartureDate` | date |  |  |
| `Itinerary` | nvarchar(500) | âœ“ |  |
| `Nights` | int | âœ“ |  |
| `DeparturePort` | nvarchar(200) | âœ“ |  |
| `Ports` | nvarchar(1000) | âœ“ |  |
| `CreatedAt` | datetime2 |  | getutcdate( |
| `IsDeparted` | bit |  | 0 |
| `ItineraryCode` | nvarchar(100) | âœ“ |  |

**Primary Key:** `CruiseLine, ShipName, DepartureDate`

---

## PriceHistory

**Rows:** 49330

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `Id` | int |  |  |
| `CruiseLine` | nvarchar(100) |  |  |
| `ShipName` | nvarchar(200) |  |  |
| `DepartureDate` | date |  |  |
| `InsidePrice` | decimal | âœ“ |  |
| `InsidePerDay` | decimal | âœ“ |  |
| `OceanviewPrice` | decimal | âœ“ |  |
| `OceanviewPerDay` | decimal | âœ“ |  |
| `BalconyPrice` | decimal | âœ“ |  |
| `BalconyPerDay` | decimal | âœ“ |  |
| `SuitePrice` | decimal | âœ“ |  |
| `SuitePerDay` | decimal | âœ“ |  |
| `ScrapedAt` | datetime2 |  | getutcdate( |
| `FLResBalconyPrice` | decimal | âœ“ |  |
| `FLResBalconyPerDay` | decimal | âœ“ |  |
| `FLResSuitePrice` | decimal | âœ“ |  |
| `FLResSuitePerDay` | decimal | âœ“ |  |
| `VerifiedBalconyPrice` | decimal | âœ“ |  |
| `VerifiedBalconyPerDay` | decimal | âœ“ |  |
| `VerifiedSuitePrice` | decimal | âœ“ |  |
| `VerifiedSuitePerDay` | decimal | âœ“ |  |
| `VerifiedAt` | datetime2 | âœ“ |  |
| `FamilyInsidePrice` | decimal | âœ“ |  |
| `FamilyInsidePerDay` | decimal | âœ“ |  |
| `FamilyOceanviewPrice` | decimal | âœ“ |  |
| `FamilyOceanviewPerDay` | decimal | âœ“ |  |
| `FamilyBalconyPrice` | decimal | âœ“ |  |
| `FamilyBalconyPerDay` | decimal | âœ“ |  |
| `FamilySuitePrice` | decimal | âœ“ |  |
| `FamilySuitePerDay` | decimal | âœ“ |  |
| `FamilyVerifiedSuitePrice` | decimal | âœ“ |  |
| `FamilyVerifiedSuitePerDay` | decimal | âœ“ |  |

**Primary Key:** `Id`

**Indexes:**
- `IX_PriceHistory_Cruise` on (CruiseLine, ShipName, DepartureDate, ScrapedAt)

---

## Restaurants

**Rows:** 679

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `Id` | int |  |  |
| `ShipName` | nvarchar(100) |  |  |
| `Name` | nvarchar(200) |  |  |
| `Type` | nvarchar(50) |  |  |
| `Cuisine` | nvarchar(100) |  |  |
| `Score` | int |  |  |
| `Why` | nvarchar(MAX) |  |  |

**Primary Key:** `Id`

---

## ScraperRuns

**Rows:** 94

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `Id` | int |  |  |
| `ScraperName` | nvarchar(50) |  |  |
| `StartedAt` | datetime2 |  |  |
| `CompletedAt` | datetime2 |  |  |
| `SailingsFound` | int |  | 0 |
| `SailingsUpdated` | int |  | 0 |
| `Errors` | nvarchar(MAX) | âœ“ |  |
| `Status` | nvarchar(20) |  | 'Success' |

**Primary Key:** `Id`

---

