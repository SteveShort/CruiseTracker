<Query Kind="Program">
  <NuGetReference>HtmlAgilityPack</NuGetReference>
  <NuGetReference>System.Data.SqlClient</NuGetReference>
  <Namespace>HtmlAgilityPack</Namespace>
  <Namespace>System.Data.SqlClient</Namespace>
  <Namespace>System.Net.Http</Namespace>
  <Namespace>System.Globalization</Namespace>
  <Namespace>System.Threading.Tasks</Namespace>
  <Namespace>System.Text.Json</Namespace>
</Query>

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Cruise Deal Tracker                                                ║
// ║  Scrapes cruise listings, tracks prices in SQL Server over time     ║
// ╚══════════════════════════════════════════════════════════════════════╝

#region ── Configuration ──────────────────────────────────────────────────

// SQL Server connection
static string SqlConnectionString = @"Server=STEVEOFFICEPC\ORACLE2SQL;Database=CruiseTracker;Integrated Security=True;TrustServerCertificate=True;";


// ── Email (commented out for now) ──
// static string SmtpHost     = "smtp.gmail.com";
// static int    SmtpPort     = 587;
// static string SmtpUser     = "you@gmail.com";
// static string SmtpPass     = "your-app-password";
// static string AlertFrom    = "you@gmail.com";
// static string AlertTo      = "you@gmail.com";

#endregion

#region ── Cruise Line Configurations ─────────────────────────────────────

// Each cruise line has its own URL and alert thresholds
// BalconyAlertPPD:  alert when Balcony $/person/day <= this
// SuiteAlertPPD:    alert when Suite/Haven $/person/day <= this
record CruiseLineConfig(
	string Name,
	string Url,
	decimal BalconyAlertPPD,
	decimal SuiteAlertPPD
);

static List<CruiseLineConfig> CruiseLines = new()
{
	// All cruise lines now use direct API scrapers instead of cruise.com:
	// - Disney: disney-scraper.js (Disney API)
	// - Norwegian: ncl-scraper.js (NCL API)
	// - Celebrity: celebrity-scraper.js (Celebrity GraphQL API)
};

// Florida ports we care about (filter results to these)
static HashSet<string> FloridaPorts = new(StringComparer.OrdinalIgnoreCase)
{
	"Port Canaveral", "Miami", "Fort Lauderdale", "Tampa",
	"Jacksonville", "Port Everglades", "Cape Canaveral",
	// Common variations
	"Ft. Lauderdale", "Ft Lauderdale", "Pt Canaveral",
};

#endregion

#region ── Data Models ────────────────────────────────────────────────────

record CruiseRecord(
	string CruiseLine,
	string ShipName,
	string Itinerary,
	DateTime DepartureDate,
	int Nights,
	string DeparturePort,
	string Ports,
	decimal InsidePrice,
	decimal InsidePerDay,
	decimal OceanviewPrice,
	decimal OceanviewPerDay,
	decimal BalconyPrice,
	decimal BalconyPerDay,
	decimal SuitePrice,
	decimal SuitePerDay,
	// FL Resident pricing (Disney only, null/0 when not available)
	decimal FLResBalconyPrice = 0,
	decimal FLResBalconyPerDay = 0,
	decimal FLResSuitePrice = 0,
	decimal FLResSuitePerDay = 0
);

record ShipInfo(
	string CruiseLine,
	string ShipName,
	string ShipClass,
	int YearBuilt,
	string LastRenovated,   // year or "None" for new ships
	int GrossTonnage,
	int PassengerCapacity,  // double occupancy
	bool HasKidsArea,
	string KidsProgram,
	string HavenLevel,      // NCL: "Full" / "Limited" / "None"; Disney: "N/A"
	string WaterFeatures,
	string FamilyNotes
);

#endregion

#region ── Ship Reference ─────────────────────────────────────────────────
// Haven Levels:
//   Full    = true "ship within a ship" — private restaurant, pool, sundeck,
//             courtyard, butler service, concierge (Breakaway/Breakaway+/Prima/Prima+)
//   Limited = Haven suites exist but NO private Haven restaurant/pool (Jewel, Epic)
//   None    = no Haven suites (Dawn, Sun class, Spirit, Sky, Pride of America)

static Dictionary<string, ShipInfo> ShipReference = new(StringComparer.OrdinalIgnoreCase)
{
	// ── DISNEY ──────────────────────────────────────────────────────────
	["Disney Magic"] = new("Disney", "Disney Magic", "Magic", 1998, "2023",
		83969, 2713, true, "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)",
		"N/A", "AquaDunk water slide, 3 pools",
		"Smallest Disney ship; classic feel; great for short itineraries"),
	["Disney Wonder"] = new("Disney", "Disney Wonder", "Magic", 1999, "2019",
		83969, 2713, true, "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)",
		"N/A", "Twist 'n' Spout slide, 3 pools",
		"Sister to Magic; sails Pacific/Alaska primarily"),
	["Disney Dream"] = new("Disney", "Disney Dream", "Dream", 2011, "2022",
		129690, 4000, true, "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)",
		"N/A", "AquaDuck water coaster, Nemo's Reef splash zone",
		"First AquaDuck ship; excellent for Bahamas from Port Canaveral"),
	["Disney Fantasy"] = new("Disney", "Disney Fantasy", "Dream", 2012, "2023",
		129690, 4000, true, "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)",
		"N/A", "AquaDuck water coaster, AquaLab splash zone",
		"Same layout as Dream; sails 7-night Caribbean from Port Canaveral"),
	["Disney Wish"] = new("Disney", "Disney Wish", "Wish (Triton)", 2022, "None",
		144000, 4000, true, "Oceaneer Club w/ slide entrance (3-10), Edge (11-14), Vibe (14-17), Hideaway",
		"N/A", "AquaMouse water ride, 6 pools, Toy Story splash zone",
		"Grand Hall with Rapunzel theme; most dining venues of any Disney ship"),
	["Disney Treasure"] = new("Disney", "Disney Treasure", "Wish (Triton)", 2024, "None",
		144000, 4000, true, "Oceaneer Club w/ slide entrance (3-10), Edge (11-14), Vibe (14-17), Hideaway",
		"N/A", "AquaMouse water ride, 6 pools",
		"Adventure-themed; Moana/Coco Grand Hall; newest Disney ship sailing"),
	["Disney Destiny"] = new("Disney", "Disney Destiny", "Wish (Triton)", 2025, "None",
		144000, 4000, true, "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17), Hideaway",
		"N/A", "AquaMouse water ride, 6 pools",
		"Heroes & Villains theme; enters service Nov 2025; sails from Ft Lauderdale"),

	// ── NORWEGIAN ───────────────────────────────────────────────────────
	["Norwegian Prima"] = new("Norwegian", "Norwegian Prima", "Prima", 2022, "None",
		142500, 3215, true, "Splash Academy (3-12), Entourage (13-17)",
		"Full", "Tidal Wave slide, Aqua Park drop slides, Infinity pool",
		"First Prima class; Haven sundeck + infinity pool; Galaxy Pavilion VR"),
	["Norwegian Viva"] = new("Norwegian", "Norwegian Viva", "Prima", 2023, "None",
		142500, 3215, true, "Splash Academy (3-12), Entourage (13-17)",
		"Full", "Tidal Wave slide, Aqua Park double drops, Infinity pool",
		"Sister to Prima; Haven with retractable glass roof courtyard"),
	["Norwegian Aqua"] = new("Norwegian", "Norwegian Aqua", "Prima Plus", 2025, "None",
		156300, 3571, true, "Splash Academy (3-12), Entourage (13-17)",
		"Full", "Aqua Slidecoaster, AquaLoop freefall, The Pier pool",
		"Largest NCL ship; elevated Haven with duplex suites; debuts 2025"),
	["Norwegian Encore"] = new("Norwegian", "Norwegian Encore", "Breakaway Plus", 2019, "2024",
		169116, 3998, true, "Splash Academy (3-12), Entourage (13-17)",
		"Full", "Aqua Park multi-story slides, go-kart racetrack",
		"Full Haven w/ private restaurant + pool; racetrack; excellent for families"),
	["Norwegian Bliss"] = new("Norwegian", "Norwegian Bliss", "Breakaway Plus", 2018, "2021",
		168028, 4004, true, "Splash Academy (3-12), Entourage (13-17)",
		"Full", "Aqua Park with Ocean Loops, go-kart racetrack",
		"Full Haven; laser tag; observation lounge"),
	["Norwegian Joy"] = new("Norwegian", "Norwegian Joy", "Breakaway Plus", 2017, "2024",
		167725, 3804, true, "Splash Academy (3-12), Entourage (13-17)",
		"Full", "Aqua Park, go-kart racetrack",
		"Full Haven; originally for Chinese market, refitted for US"),
	["Norwegian Escape"] = new("Norwegian", "Norwegian Escape", "Breakaway Plus", 2015, "2022",
		164600, 4266, true, "Splash Academy (3-12), Entourage (13-17), Guppies Nursery",
		"Full", "Aqua Park 5 multi-story slides, rope course",
		"Full Haven; one of the largest ships; sails from NYC primarily"),
	["Norwegian Breakaway"] = new("Norwegian", "Norwegian Breakaway", "Breakaway", 2013, "2025",
		145655, 3963, true, "Splash Academy (3-12), Entourage (13-17)",
		"Full", "Aqua Park 5 slides, rope course, 2 pools",
		"Full Haven (slightly smaller); sails New Orleans/East Coast"),
	["Norwegian Getaway"] = new("Norwegian", "Norwegian Getaway", "Breakaway", 2014, "2019",
		145655, 3963, true, "Splash Academy (3-12), Entourage (13-17)",
		"Full", "Aqua Park slides, rope course, pools",
		"Full Haven; sails Port Canaveral/Caribbean"),
	["Norwegian Epic"] = new("Norwegian", "Norwegian Epic", "Epic", 2010, "2025",
		155873, 4100, true, "Splash Academy (3-12), Entourage (13-17)",
		"Limited", "Aqua Park with Epic Plunge, 3 pools, kids pool",
		"⚠️ Haven suites but NO separate Haven restaurant/pool; unique studio cabins"),
	["Norwegian Gem"] = new("Norwegian", "Norwegian Gem", "Jewel", 2007, "2015",
		93530, 2394, true, "Splash Academy (3-12), Entourage (13-17)",
		"Limited", "Pool deck, kids pool",
		"Haven courtyard but smaller/older; no private Haven restaurant"),
	["Norwegian Jewel"] = new("Norwegian", "Norwegian Jewel", "Jewel", 2005, "2018",
		93502, 2376, true, "Splash Academy (3-12), Entourage (13-17)",
		"Limited", "Pool deck, kids pool",
		"Older Jewel class; Haven suites with limited private amenities"),
	["Norwegian Jade"] = new("Norwegian", "Norwegian Jade", "Jewel", 2006, "2017",
		93558, 2402, true, "Splash Academy (3-12), Entourage (13-17)",
		"Limited", "Pool deck, kids pool",
		"Mostly European itineraries; limited Haven complex"),
	["Norwegian Pearl"] = new("Norwegian", "Norwegian Pearl", "Jewel", 2006, "2017",
		93530, 2394, true, "Splash Academy (3-12), Entourage (13-17)",
		"Limited", "Bowl slide, pool deck, kids pool",
		"Jewel class; has bowling alley; Haven with limited private areas"),
	["Norwegian Dawn"] = new("Norwegian", "Norwegian Dawn", "Dawn", 2002, "2021",
		91740, 2340, true, "Splash Academy (3-12), Entourage (13-17)",
		"None", "Pool deck, kids pool",
		"⚠️ NO Haven suites; older/smaller ship"),
	["Norwegian Star"] = new("Norwegian", "Norwegian Star", "Dawn", 2001, "2018",
		91740, 2348, true, "Splash Academy (3-12), Entourage (13-17)",
		"None", "Pool deck, kids pool",
		"⚠️ NO Haven; primarily sails Europe"),
	["Norwegian Sun"] = new("Norwegian", "Norwegian Sun", "Sun", 2001, "2018",
		78309, 1936, true, "Splash Academy (3-12), Entourage (13-17)",
		"None", "Pool deck, kids pool",
		"⚠️ NO Haven; smaller ship; port-intensive itineraries"),
	["Norwegian Sky"] = new("Norwegian", "Norwegian Sky", "Sun", 1999, "2019",
		77104, 2004, true, "Splash Academy (3-12), Entourage (13-17)",
		"None", "Pool deck",
		"⚠️ NO Haven; free open bar included; short Bahamas from Miami"),
	["Norwegian Spirit"] = new("Norwegian", "Norwegian Spirit", "Unclassed", 1998, "2020",
		75338, 2018, false, "⛔ NO kids program (no Splash Academy)",
		"None", "Pool deck",
		"⛔ NO kids program AND no Haven — NOT SUITABLE for families"),
	["Pride of America"] = new("Norwegian", "Pride of America", "Unclassed", 2005, "2025",
		80439, 2186, true, "Splash Academy (3-12), Entourage (13-17)",
		"None", "Pool deck, kids pool",
		"⚠️ Hawaii only (US-flagged); NO Haven; inter-island itinerary"),

	// ── CELEBRITY ─────────────────────────────────────────────────────────
	["Celebrity Edge"] = new("Celebrity", "Celebrity Edge", "Edge", 2018, "None",
		130818, 2908, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Rooftop Garden, Resort Deck pool, solarium",
		"First Edge class; outward-facing design with Magic Carpet bar; primarily Europe"),
	["Celebrity Apex"] = new("Celebrity", "Celebrity Apex", "Edge", 2020, "None",
		130818, 2910, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Rooftop Garden, Resort Deck pool, solarium",
		"Sails Caribbean from Port Canaveral; sister to Edge"),
	["Celebrity Beyond"] = new("Celebrity", "Celebrity Beyond", "Edge", 2022, "None",
		140600, 3260, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Rooftop Garden, multi-level Resort Deck, solarium",
		"Larger Edge-class variant; two-story Sunset Bar; sails from Ft Lauderdale"),
	["Celebrity Ascent"] = new("Celebrity", "Celebrity Ascent", "Edge", 2023, "None",
		140600, 3260, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Rooftop Garden, multi-level Resort Deck, solarium",
		"Sister to Beyond; sails Caribbean from Ft Lauderdale"),
	["Celebrity Xcel"] = new("Celebrity", "Celebrity Xcel", "Edge", 2025, "None",
		140600, 3260, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Rooftop Garden, Resort Deck, solarium",
		"Newest Celebrity ship; debuts Nov 2025 from Ft Lauderdale"),
	["Celebrity Eclipse"] = new("Celebrity", "Celebrity Eclipse", "Solstice", 2010, "2019",
		121878, 2850, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Pool deck, solarium, lawn club",
		"Solstice class; real grass Lawn Club; sails from Ft Lauderdale"),
	["Celebrity Silhouette"] = new("Celebrity", "Celebrity Silhouette", "Solstice", 2011, "2020",
		122210, 2886, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Pool deck, solarium, lawn club",
		"Solstice class; revolutionized with refurbishment; sails from Ft Lauderdale"),
	["Celebrity Reflection"] = new("Celebrity", "Celebrity Reflection", "Solstice", 2012, "2020",
		125366, 3046, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Pool deck, solarium, lawn club, The Alcoves",
		"Largest Solstice class; suite-only sundeck added; sails Ft Lauderdale"),
	["Celebrity Summit"] = new("Celebrity", "Celebrity Summit", "Millennium", 2001, "2019",
		90940, 2158, true, "Camp at Sea: Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)",
		"N/A", "Pool deck, solarium",
		"Millennium class; modernized 2019; smaller/more intimate; sails from Ft Lauderdale"),
};

/// <summary>Look up a ship by name. Tries exact match, then partial/contains.</summary>
static ShipInfo LookupShip(string shipName)
{
	if (ShipReference.TryGetValue(shipName, out var info)) return info;
	var match = ShipReference.FirstOrDefault(kv =>
		kv.Key.Contains(shipName, StringComparison.OrdinalIgnoreCase) ||
		shipName.Contains(kv.Key, StringComparison.OrdinalIgnoreCase));
	return match.Value;
}

#endregion


// ════════════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ════════════════════════════════════════════════════════════════════════

async Task Main()
{
	"╔══════════════════════════════════════════════╗".Dump();
	"║       🚢  Cruise Deal Tracker  🚢          ║".Dump();
	$"║  Run time:  {DateTime.Now:yyyy-MM-dd HH:mm}          ║".Dump();
	"╚══════════════════════════════════════════════╝".Dump();

	EnsureDatabase();

	// -- Flag departed sailings (departure date has passed) --
	try
	{
		using (var conn = new System.Data.SqlClient.SqlConnection(SqlConnectionString))
		{
			conn.Open();
			var flagCmd = new System.Data.SqlClient.SqlCommand(
				@"UPDATE Cruises SET IsDeparted = 1 WHERE DepartureDate < CAST(GETDATE() AS DATE) AND IsDeparted = 0", conn);
			var flagged = flagCmd.ExecuteNonQuery();
			if (flagged > 0) $"   Flagged {flagged} departed sailing(s)".Dump();
		}
	}
	catch (Exception ex) { $"   Warning: Could not flag departed sailings: {ex.Message}".Dump(); }

	var allCruises = new List<CruiseRecord>();
	var errors = new List<(string Line, string Error)>();

	foreach (var config in CruiseLines)
	{
		try
		{
			$"\n🔍 Scraping {config.Name}...".Dump();
			var cruises = await ScrapeCruisesAsync(config);

			// Filter to Florida departure ports only
			var floridaCruises = cruises
				.Where(c => FloridaPorts.Any(fp => c.DeparturePort.Contains(fp, StringComparison.OrdinalIgnoreCase)
					|| fp.Contains(c.DeparturePort, StringComparison.OrdinalIgnoreCase)))
				.ToList();

			var nonFlCount = cruises.Count - floridaCruises.Count;
			if (nonFlCount > 0)
				$"   📍  Filtered out {nonFlCount} non-Florida sailings".Dump();

			if (floridaCruises.Count == 0)
			{
				$"⚠️  No Florida cruises found for {config.Name}.".Dump();
				if (cruises.Count > 0)
				{
					$"   (Found {cruises.Count} total sailings, but none from Florida ports)".Dump();
					cruises.Select(c => c.DeparturePort).Distinct().OrderBy(p => p).Dump($"Available ports for {config.Name}");
				}
			}
			else
			{
				$"✅  Found {floridaCruises.Count} Florida sailings for {config.Name}".Dump();
				floridaCruises
					.OrderBy(c => c.DepartureDate)
					.Select(c => {
						var si = LookupShip(c.ShipName);
						return new {
							c.ShipName,
							Class = si?.ShipClass ?? "?",
							Built = si?.YearBuilt.ToString() ?? "?",
							c.Itinerary,
							Departs = c.DepartureDate.ToString("MMM dd, yyyy"),
							Port = c.DeparturePort,
							c.Nights,
							Balcony = c.BalconyPrice > 0 ? c.BalconyPrice.ToString("C0") : "N/A",
							BPD = c.BalconyPerDay > 0 ? c.BalconyPerDay.ToString("C0") : "N/A",
							Suite = c.SuitePrice > 0 ? c.SuitePrice.ToString("C0") : "N/A",
							SPD = c.SuitePerDay > 0 ? c.SuitePerDay.ToString("C0") : "N/A",
							Haven = si?.HavenLevel ?? "?",
							Kids = si == null ? "?" : si.HasKidsArea ? "✅" : "⛔",
						};
					})
					.Dump($"{config.Name} — Florida Sailings (Balcony & Suite/Haven)");
			}

			allCruises.AddRange(floridaCruises);
		}
		catch (Exception ex)
		{
			$"❌  Error scraping {config.Name}: {ex.Message}".Dump();
			errors.Add((config.Name, ex.Message));
		}
	}

	// -- Disney Standard Pricing (Node.js scraper) --
	try
	{
		"\\n   Running Disney standard pricing scraper...".Dump();
		var disneyPath = @"c:\Dev\Cruise Tracker\scraper\disney-scraper.js";
		var dPsi = new System.Diagnostics.ProcessStartInfo
		{
			FileName = "node",
			Arguments = $"\"{disneyPath}\""",
			WorkingDirectory = Path.GetDirectoryName(disneyPath),
			RedirectStandardOutput = true,
			RedirectStandardError = true,
			UseShellExecute = false,
			CreateNoWindow = true,
		};
		using var dProc = System.Diagnostics.Process.Start(dPsi);
		var dOutput = dProc.StandardOutput.ReadToEnd();
		var dError = dProc.StandardError.ReadToEnd();
		dProc.WaitForExit(TimeSpan.FromMinutes(10));

		var dSummary = dOutput.Split('\n').LastOrDefault(l => l.Contains("Total:") || l.Contains("DB:"));
		if (!string.IsNullOrWhiteSpace(dSummary)) $"   {dSummary.Trim()}".Dump();

		if (dProc.ExitCode == 0) $"  Disney scraper completed successfully".Dump();
		else
		{
			$"  Disney scraper exited with code {dProc.ExitCode}".Dump();
			if (!string.IsNullOrWhiteSpace(dError)) $"   {dError.Trim().Substring(0, Math.Min(500, dError.Trim().Length))}".Dump();
		}
	}
	catch (Exception ex) { $"  Disney scraper failed: {ex.Message}".Dump(); }

	// -- Disney FL Resident Pricing (Node.js scraper) --
	try
	{
		"\\n  Running Disney FL Resident pricing scraper...".Dump();
		var flScraperPath = @"c:\Dev\Cruise Tracker\scraper\disney-fl-scraper.js";
		var flPsi = new System.Diagnostics.ProcessStartInfo
		{
			FileName = "node",
			Arguments = $"\"{flScraperPath}\""",
			WorkingDirectory = Path.GetDirectoryName(flScraperPath),
			RedirectStandardOutput = true,
			RedirectStandardError = true,
			UseShellExecute = false,
			CreateNoWindow = true,
		};
		using var flProc = System.Diagnostics.Process.Start(flPsi);
		var flOutput = flProc.StandardOutput.ReadToEnd();
		var flErrorOutput = flProc.StandardError.ReadToEnd();
		flProc.WaitForExit(TimeSpan.FromMinutes(10));

		var flSummary = flOutput.Split('\n')
			.LastOrDefault(l => l.Contains("Total:") || l.Contains("DB:"));
		if (!string.IsNullOrWhiteSpace(flSummary))
			$"   {flSummary.Trim()}".Dump();

		if (flProc.ExitCode == 0)
			$"  Disney FL Resident scraper completed successfully".Dump();
		else
		{
			$"  Disney FL Resident scraper exited with code {flProc.ExitCode}".Dump();
			if (!string.IsNullOrWhiteSpace(flErrorOutput))
				$"   {flErrorOutput.Trim().Substring(0, Math.Min(500, flErrorOutput.Trim().Length))}".Dump();
		}
	}
	catch (Exception ex)
	{
		$"  Disney FL Resident scraper failed: {ex.Message}".Dump();
	}

	if (allCruises.Count > 0)
	{
		UpsertCruises(allCruises);
		$"\n💾  Saved {allCruises.Count} cruise records to database.".Dump();
	}

	// ── NCL Verified Prices (Playwright scraper) ──
	try
	{
		"\n🔍 Running NCL verified price scraper...".Dump();
		var scraperPath = @"c:\Dev\Cruise Tracker\scraper\ncl-scraper.js";
		var psi = new System.Diagnostics.ProcessStartInfo
		{
			FileName = "node",
			Arguments = $"\"{scraperPath}\"",
			WorkingDirectory = Path.GetDirectoryName(scraperPath),
			RedirectStandardOutput = true,
			RedirectStandardError = true,
			UseShellExecute = false,
			CreateNoWindow = true,
		};
		using var proc = System.Diagnostics.Process.Start(psi);
		var output = proc.StandardOutput.ReadToEnd();
		var errorOutput = proc.StandardError.ReadToEnd();
		proc.WaitForExit(TimeSpan.FromMinutes(30));

		// Show summary line from output
		var summaryLine = output.Split('\n')
			.LastOrDefault(l => l.Contains("Total:") || l.Contains("DB:") || l.Contains("sailings verified"));
		if (!string.IsNullOrWhiteSpace(summaryLine))
			$"   {summaryLine.Trim()}".Dump();

		if (proc.ExitCode == 0)
			$"✅  NCL scraper completed successfully".Dump();
		else
		{
			$"⚠️  NCL scraper exited with code {proc.ExitCode}".Dump();
			if (!string.IsNullOrWhiteSpace(errorOutput))
				$"   {errorOutput.Trim().Substring(0, Math.Min(500, errorOutput.Trim().Length))}".Dump();
		}
	}
	catch (Exception ex)
	{
		$"❌  NCL scraper failed: {ex.Message}".Dump();
		"   💡 Make sure Node.js is installed and ncl-scraper.js exists".Dump();
	}

	// ── Celebrity Verified Prices (GraphQL scraper) ──
	try
	{
		"\n🔍 Running Celebrity verified price scraper...".Dump();
		var celScraperPath = @"c:\Dev\Cruise Tracker\scraper\celebrity-scraper.js";
		var celProc = new Process
		{
			StartInfo = new ProcessStartInfo
			{
				FileName = "node",
				Arguments = $"\"{celScraperPath}\"",
				WorkingDirectory = Path.GetDirectoryName(celScraperPath),
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				UseShellExecute = false,
				CreateNoWindow = true
			}
		};
		celProc.Start();
		var celOutput = celProc.StandardOutput.ReadToEnd();
		var celError = celProc.StandardError.ReadToEnd();
		celProc.WaitForExit();

		if (!string.IsNullOrWhiteSpace(celOutput)) celOutput.Dump();
		if (!string.IsNullOrWhiteSpace(celError)) $"Celebrity stderr: {celError}".Dump();

		if (celProc.ExitCode == 0)
			$"✅  Celebrity scraper completed successfully".Dump();
		else
			$"⚠️  Celebrity scraper exited with code {celProc.ExitCode}".Dump();
	}
	catch (Exception ex)
	{
		$"❌  Celebrity scraper failed: {ex.Message}".Dump();
	}

	// ── Check for deals per cruise line ──
	"\n── 🔔 Deal Alerts ──".Dump();
	foreach (var config in CruiseLines)
	{
		var lineCruises = allCruises.Where(c => c.CruiseLine == config.Name).ToList();
		if (lineCruises.Count == 0) continue;

		// Balcony deals
		var balconyDeals = lineCruises
			.Where(c => c.BalconyPerDay > 0 && c.BalconyPerDay <= config.BalconyAlertPPD)
			.OrderBy(c => c.BalconyPerDay)
			.ToList();

		if (balconyDeals.Count > 0)
		{
			$"🎉  {config.Name}: {balconyDeals.Count} Balcony deal(s) ≤ ${config.BalconyAlertPPD}/ppd!".Dump();
			balconyDeals
				.Select(c => new { c.ShipName, c.Itinerary, Departs = c.DepartureDate.ToString("MMM dd"), c.Nights, Balcony = c.BalconyPrice.ToString("C0"), PPD = c.BalconyPerDay.ToString("C0") })
				.Dump($"🔥 {config.Name} Balcony Deals");
		}
		else
		{
			$"   {config.Name}: No Balcony deals ≤ ${config.BalconyAlertPPD}/ppd".Dump();
		}

		// Suite/Haven deals
		var suiteDeals = lineCruises
			.Where(c => c.SuitePerDay > 0 && c.SuitePerDay <= config.SuiteAlertPPD)
			.OrderBy(c => c.SuitePerDay)
			.ToList();

		if (suiteDeals.Count > 0)
		{
			var label = config.Name == "Norwegian" ? "Haven/Suite" : "Suite";
			$"🎉  {config.Name}: {suiteDeals.Count} {label} deal(s) ≤ ${config.SuiteAlertPPD}/ppd!".Dump();
			suiteDeals
				.Select(c => new { c.ShipName, c.Itinerary, Departs = c.DepartureDate.ToString("MMM dd"), c.Nights, Suite = c.SuitePrice.ToString("C0"), PPD = c.SuitePerDay.ToString("C0") })
				.Dump($"🔥 {config.Name} {label} Deals");
		}
		else
		{
			var label = config.Name == "Norwegian" ? "Haven/Suite" : "Suite";
			$"   {config.Name}: No {label} deals ≤ ${config.SuiteAlertPPD}/ppd".Dump();
		}
	}

	// ── Show price history summary ──
	DumpPriceHistory();

	// ── Ship Fleet Reference for ships in results ──
	var shipsInResults = allCruises.Select(c => c.ShipName).Distinct().OrderBy(s => s).ToList();
	if (shipsInResults.Count > 0)
	{
		shipsInResults
			.Select(name => {
				var si = LookupShip(name);
				return new {
					Ship = name,
					Class = si?.ShipClass ?? "Unknown",
					Built = si?.YearBuilt.ToString() ?? "?",
					Renovated = si?.LastRenovated ?? "?",
					GT = si != null ? $"{si.GrossTonnage:N0}" : "?",
					Pax = si?.PassengerCapacity.ToString("N0") ?? "?",
					Kids = si == null ? "?" : si.HasKidsArea ? "✅ " + si.KidsProgram : "⛔ NONE",
					Haven = si?.HavenLevel ?? "N/A",
					Notes = si?.FamilyNotes ?? "",
				};
			})
			.Dump("🚢 Ship Fleet Reference (ships in your results)");
	}

	if (errors.Count > 0)
		errors.Dump("⚠️ Errors During Scraping");

	$"\n✅  Done at {DateTime.Now:HH:mm:ss}".Dump();
}

// ════════════════════════════════════════════════════════════════════════
//  SCRAPING
// ════════════════════════════════════════════════════════════════════════
//
//  HTML structure (cruise.com):
//    <article class="crCruiseListing">
//      <div class="crCruiseBox">
//        <h3 class="crLengthDestination">3 Days Bahamas</h3>
//        <div class="crVendorCruise">Cruise Line • <span>Ship Name</span></div>
//        <div class="crPortList">Port A, Port B, ...</div>
//        <div class="crSailingDates"><span class="label">N departure dates: </span>Date1, Date2</div>
//        <div class="crPrices">
//          <div class="cabinType I"><div class="price">$XXX</div><div class="perDay">$XX per day</div></div>
//          <div class="cabinType O">...</div>
//          <div class="cabinType B">...</div>  ← Balcony
//          <div class="cabinType S">...</div>  ← Suite (Haven for NCL)
//        </div>
//      </div>
//    </article>
//

static HttpClient CreateHttpClient()
{
	var handler = new HttpClientHandler
	{
		AutomaticDecompression = System.Net.DecompressionMethods.GZip
			| System.Net.DecompressionMethods.Deflate
			| System.Net.DecompressionMethods.Brotli,
		UseCookies = true,
		CookieContainer = new System.Net.CookieContainer(),
	};

	var client = new HttpClient(handler);
	client.Timeout = TimeSpan.FromSeconds(30);

	client.DefaultRequestHeaders.Add("User-Agent",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
	client.DefaultRequestHeaders.Add("Accept",
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
	client.DefaultRequestHeaders.Add("Accept-Language", "en-US,en;q=0.9");
	client.DefaultRequestHeaders.Add("Accept-Encoding", "gzip, deflate, br");
	client.DefaultRequestHeaders.Add("Connection", "keep-alive");
	client.DefaultRequestHeaders.Add("Cache-Control", "max-age=0");
	client.DefaultRequestHeaders.Add("Upgrade-Insecure-Requests", "1");

	return client;
}

async Task<List<CruiseRecord>> ScrapeCruisesAsync(CruiseLineConfig config)
{
	using var client = CreateHttpClient();
	// Warmer: establish cookies with Incapsula by visiting homepage
	try
	{
		client.DefaultRequestHeaders.Add("Referer", "https://www.cruise.com/");
		client.DefaultRequestHeaders.Add("Sec-Fetch-Dest", "document");
		client.DefaultRequestHeaders.Add("Sec-Fetch-Mode", "navigate");
		client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "same-site");
		await client.GetAsync("https://www.cruise.com/");
		await Task.Delay(1500);
		await client.GetAsync("https://cs.cruise.com/");
		await Task.Delay(2000);
	}
	catch { }

	var allCruisesFromPages = new List<CruiseRecord>();
	var currentUrl = config.Url;
	var pageNum = 1;
	var maxPage = 1; // will be updated from crPaging div on page 1
	const int maxPages = 50; // safety cap

	while (currentUrl != null && pageNum <= maxPages)
	{
		var response = await client.GetAsync(currentUrl);
		response.EnsureSuccessStatusCode();
		var html = await response.Content.ReadAsStringAsync();

		if (pageNum == 1)
			$"   📄  Page fetched: {html.Length:N0} chars".Dump();

		// Check if blocked by Incapsula — retry once with extra delay
		if (html.Contains("Incapsula", StringComparison.OrdinalIgnoreCase) && html.Length < 5000)
		{
			$"   ⚠️  Incapsula challenge detected — waiting 4s and retrying...".Dump();
			await Task.Delay(4000);
			response = await client.GetAsync(currentUrl);
			html = await response.Content.ReadAsStringAsync();
			$"   📄  Retry fetched: {html.Length:N0} chars".Dump();
			if (html.Contains("Incapsula", StringComparison.OrdinalIgnoreCase) && html.Length < 5000)
			{
				"   ❌  Still blocked by Incapsula bot protection.".Dump();
				break;
			}
		}

		var doc = new HtmlDocument();
		doc.LoadHtml(html);

		// Show page title on first page
		if (pageNum == 1)
		{
			var titleNode = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'zzPageTitle')]");
			if (titleNode != null)
				$"   📋  {HtmlEntity.DeEntitize(titleNode.InnerText).Trim()}".Dump();
		}

		var articles = doc.DocumentNode.SelectNodes("//article[contains(@class,'crCruiseListing')]");
		if (articles == null || articles.Count == 0)
		{
			if (pageNum == 1)
			{
				"   ⚠️  No cruise listings found on page.".Dump();
				var preview = html.Length > 2000 ? html.Substring(0, 2000) : html;
				Util.RawHtml($"<details><summary>🔧 Page preview ({html.Length:N0} chars)</summary><pre>{System.Net.WebUtility.HtmlEncode(preview)}</pre></details>").Dump();
			}
			break;
		}

		$"   📦  Page {pageNum}: {articles.Count} itineraries".Dump();

		// Parse all articles on this page
		foreach (var article in articles)
		{
			try
			{
				var shipNode = article.SelectSingleNode(".//div[contains(@class,'crVendorCruise')]/span");
				var ship = shipNode != null ? HtmlEntity.DeEntitize(shipNode.InnerText).Trim() : "Unknown Ship";

				var itinNode = article.SelectSingleNode(".//h3[contains(@class,'crLengthDestination')]");
				var itinerary = itinNode != null ? HtmlEntity.DeEntitize(itinNode.InnerText).Trim() : "Unknown";
				var nights = ParseNights(itinerary);

				var portsNode = article.SelectSingleNode(".//div[contains(@class,'crPortList')]");
				var ports = portsNode != null ? HtmlEntity.DeEntitize(portsNode.InnerText).Trim() : "";
				var departurePort = ports.Split(',').FirstOrDefault()?.Trim() ?? "";

				var insidePrice     = GetCabinPrice(article, "I");
				var insidePerDay    = GetCabinPerDay(article, "I");
				var oceanviewPrice  = GetCabinPrice(article, "O");
				var oceanviewPerDay = GetCabinPerDay(article, "O");
				var balconyPrice    = GetCabinPrice(article, "B");
				var balconyPerDay   = GetCabinPerDay(article, "B");
				var suitePrice      = GetCabinPrice(article, "S");
				var suitePerDay     = GetCabinPerDay(article, "S");

				var sailDatesNode = article.SelectSingleNode(".//div[contains(@class,'crSailingDates')]");
				var departureDates = new List<DateTime>();
				if (sailDatesNode != null)
				{
					var fullText = HtmlEntity.DeEntitize(sailDatesNode.InnerText).Trim();
					var labelNode = sailDatesNode.SelectSingleNode("./span[contains(@class,'label')]");
					var labelText = labelNode != null ? HtmlEntity.DeEntitize(labelNode.InnerText) : "";
					var datesText = fullText;
					if (!string.IsNullOrEmpty(labelText))
						datesText = fullText.Replace(labelText, "").Trim();
					foreach (var datePart in datesText.Split(','))
					{
						var parsed = ParseDate(datePart.Trim());
						if (parsed.HasValue) departureDates.Add(parsed.Value);
					}
				}

				foreach (var depDate in departureDates)
				{
					allCruisesFromPages.Add(new CruiseRecord(
						CruiseLine: config.Name, ShipName: ship, Itinerary: itinerary,
						DepartureDate: depDate, Nights: nights,
						DeparturePort: departurePort, Ports: ports,
						InsidePrice: insidePrice, InsidePerDay: insidePerDay,
						OceanviewPrice: oceanviewPrice, OceanviewPerDay: oceanviewPerDay,
						BalconyPrice: balconyPrice, BalconyPerDay: balconyPerDay,
						SuitePrice: suitePrice, SuitePerDay: suitePerDay
					));
				}
			}
			catch (Exception ex)
			{
				$"   ⚠️  Error parsing article: {ex.Message}".Dump();
			}
		}

		// ── Pagination via &pg=N URL parameter ──
		// The crPaging div shows page numbers that change as you advance.
		// Re-check every page to discover higher page numbers (e.g. 11-20, 21-30).
		var pagingDiv = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'crPaging')]");
		if (pagingDiv != null)
		{
			var pageNums = pagingDiv.SelectNodes(".//a")
				?.Select(a => { int.TryParse(HtmlEntity.DeEntitize(a.InnerText).Trim(), out var n); return n; })
				.Where(n => n > 0)
				.ToList() ?? new List<int>();
			
			// Also check data-pgno for the "..." next-set link
			var dataPgNos = pagingDiv.SelectNodes(".//a[@data-pgno]")
				?.Select(a => { int.TryParse(a.GetAttributeValue("data-pgno", ""), out var n); return n; })
				.Where(n => n > 0)
				.ToList() ?? new List<int>();
			
			var allNums = pageNums.Concat(dataPgNos).Distinct().ToList();
			if (allNums.Count > 0)
			{
				var newMax = allNums.Max();
				if (newMax > maxPage)
				{
					maxPage = newMax;
					if (pageNum == 1)
						$"   📄  Pagination detected: up to page {maxPage}+ (via crPaging div)".Dump();
				}
			}
		}

		// Move to next page — always try if we got articles on this page
		// (handles sites without crPaging div, like Disney)
		if (articles != null && articles.Count > 0)
		{
			currentUrl = config.Url + $"&pg={pageNum + 1}";
		}
		else
		{
			currentUrl = null; // no articles = we've gone past the last page
		}

		pageNum++;
		if (currentUrl != null)
			await Task.Delay(800); // be polite between pages
	}

	$"   📊  Total: {allCruisesFromPages.Count} sailings across {pageNum - 1} page(s)".Dump();

	return allCruisesFromPages;
}


#region ── Parsing Helpers ────────────────────────────────────────────────

static decimal GetCabinPrice(HtmlNode article, string cabinClass)
{
	var node = article.SelectSingleNode($".//div[contains(@class,'cabinType') and contains(@class,'{cabinClass}')]/div[contains(@class,'price')]");
	return node != null ? ParsePrice(HtmlEntity.DeEntitize(node.InnerText)) : 0;
}

static decimal GetCabinPerDay(HtmlNode article, string cabinClass)
{
	var node = article.SelectSingleNode($".//div[contains(@class,'cabinType') and contains(@class,'{cabinClass}')]/div[contains(@class,'perDay')]");
	return node != null ? ParsePrice(HtmlEntity.DeEntitize(node.InnerText)) : 0;
}

static DateTime? ParseDate(string s)
{
	if (string.IsNullOrWhiteSpace(s)) return null;

	string[] formats = {
		"MMM dd yyyy", "MMM d yyyy", "MMM dd, yyyy", "MMM d, yyyy",
		"MM/dd/yyyy", "M/d/yyyy", "MMMM dd, yyyy", "MMMM dd yyyy",
		"MM-dd-yyyy", "yyyy-MM-dd", "dd MMM yyyy",
		"M/d/yy", "MM/dd/yy"
	};

	if (DateTime.TryParseExact(s.Trim(), formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
		return dt;

	if (DateTime.TryParse(s.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out dt))
		return dt;

	return null;
}

static int ParseNights(string s)
{
	if (string.IsNullOrWhiteSpace(s)) return 0;
	var match = Regex.Match(s, @"(\d+)\s*(?:day|night|nt)", RegexOptions.IgnoreCase);
	if (match.Success) return int.Parse(match.Groups[1].Value);
	match = Regex.Match(s, @"(\d+)");
	return match.Success ? int.Parse(match.Groups[1].Value) : 0;
}

static decimal ParsePrice(string s)
{
	if (string.IsNullOrWhiteSpace(s)) return 0;
	var cleaned = Regex.Replace(s, @"[^\d.]", "");
	return decimal.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var price)
		? price : 0;
}

#endregion

// ════════════════════════════════════════════════════════════════════════
//  DATABASE  (SQL Server)
// ════════════════════════════════════════════════════════════════════════

void EnsureDatabase()
{
	using (var masterConn = new SqlConnection(@"Server=STEVEOFFICEPC\ORACLE2SQL;Database=master;Integrated Security=True;TrustServerCertificate=True;"))
	{
		masterConn.Open();
		new SqlCommand(@"
			IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'CruiseTracker')
				CREATE DATABASE CruiseTracker;
		", masterConn).ExecuteNonQuery();
	}

	using var conn = new SqlConnection(SqlConnectionString);
	conn.Open();

	new SqlCommand(@"
		IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Cruises')
		BEGIN
			CREATE TABLE Cruises (
				CruiseLine    NVARCHAR(100)  NOT NULL,
				ShipName      NVARCHAR(200)  NOT NULL,
				DepartureDate DATE           NOT NULL,
				Itinerary     NVARCHAR(500)  NULL,
				Nights        INT            NULL,
				DeparturePort NVARCHAR(200)  NULL,
				Ports         NVARCHAR(1000) NULL,
				CreatedAt     DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
				CONSTRAINT PK_Cruises PRIMARY KEY (CruiseLine, ShipName, DepartureDate)
			);
		END

		IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PriceHistory')
		BEGIN
			CREATE TABLE PriceHistory (
				Id                INT IDENTITY(1,1) PRIMARY KEY,
				CruiseLine        NVARCHAR(100)  NOT NULL,
				ShipName          NVARCHAR(200)  NOT NULL,
				DepartureDate     DATE           NOT NULL,
				InsidePrice       DECIMAL(10,2)  NULL,
				InsidePerDay      DECIMAL(10,2)  NULL,
				OceanviewPrice    DECIMAL(10,2)  NULL,
				OceanviewPerDay   DECIMAL(10,2)  NULL,
				BalconyPrice      DECIMAL(10,2)  NULL,
				BalconyPerDay     DECIMAL(10,2)  NULL,
				SuitePrice        DECIMAL(10,2)  NULL,
				SuitePerDay       DECIMAL(10,2)  NULL,
				ScrapedAt         DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
				CONSTRAINT FK_PriceHistory_Cruises
					FOREIGN KEY (CruiseLine, ShipName, DepartureDate)
					REFERENCES Cruises (CruiseLine, ShipName, DepartureDate)
			);
			CREATE INDEX IX_PriceHistory_Cruise
				ON PriceHistory (CruiseLine, ShipName, DepartureDate, ScrapedAt);
		END
	", conn).ExecuteNonQuery();

	// ── Migration: Add FL Resident columns if they don't exist ──
	new SqlCommand(@"
		IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('PriceHistory') AND name = 'FLResBalconyPrice')
		BEGIN
			ALTER TABLE PriceHistory ADD
				FLResBalconyPrice   DECIMAL(10,2) NULL,
				FLResBalconyPerDay  DECIMAL(10,2) NULL,
				FLResSuitePrice     DECIMAL(10,2) NULL,
				FLResSuitePerDay    DECIMAL(10,2) NULL;
		END
	", conn).ExecuteNonQuery();
}

void UpsertCruises(List<CruiseRecord> cruises)
{
	using var conn = new SqlConnection(SqlConnectionString);
	conn.Open();

	foreach (var c in cruises)
	{
		// Upsert the cruise
		new SqlCommand(@"
			MERGE Cruises AS tgt
			USING (SELECT @line AS CruiseLine, @ship AS ShipName, @date AS DepartureDate) AS src
			   ON tgt.CruiseLine = src.CruiseLine AND tgt.ShipName = src.ShipName AND tgt.DepartureDate = src.DepartureDate
			WHEN MATCHED THEN
				UPDATE SET Itinerary = @itin, Nights = @nights, DeparturePort = @port, Ports = @ports
			WHEN NOT MATCHED THEN
				INSERT (CruiseLine, ShipName, DepartureDate, Itinerary, Nights, DeparturePort, Ports)
				VALUES (@line, @ship, @date, @itin, @nights, @port, @ports);
		", conn)
		{
			Parameters = {
				new SqlParameter("@line",   c.CruiseLine),
				new SqlParameter("@ship",   c.ShipName),
				new SqlParameter("@date",   c.DepartureDate),
				new SqlParameter("@itin",   (object)c.Itinerary ?? DBNull.Value),
				new SqlParameter("@nights", c.Nights),
				new SqlParameter("@port",   (object)c.DeparturePort ?? DBNull.Value),
				new SqlParameter("@ports",  (object)c.Ports ?? DBNull.Value),
			}
		}.ExecuteNonQuery();

		// Insert price snapshot (including FL Resident pricing if available)
		new SqlCommand(@"
			INSERT INTO PriceHistory
				(CruiseLine, ShipName, DepartureDate,
				 InsidePrice, InsidePerDay, OceanviewPrice, OceanviewPerDay,
				 BalconyPrice, BalconyPerDay, SuitePrice, SuitePerDay,
				 FLResBalconyPrice, FLResBalconyPerDay, FLResSuitePrice, FLResSuitePerDay)
			VALUES
				(@line, @ship, @date,
				 @ip, @ipd, @op, @opd,
				 @bp, @bpd, @sp, @spd,
				 @flbp, @flbpd, @flsp, @flspd);
		", conn)
		{
			Parameters = {
				new SqlParameter("@line", c.CruiseLine),
				new SqlParameter("@ship", c.ShipName),
				new SqlParameter("@date", c.DepartureDate),
				new SqlParameter("@ip",   c.InsidePrice),
				new SqlParameter("@ipd",  c.InsidePerDay),
				new SqlParameter("@op",   c.OceanviewPrice),
				new SqlParameter("@opd",  c.OceanviewPerDay),
				new SqlParameter("@bp",   c.BalconyPrice),
				new SqlParameter("@bpd",  c.BalconyPerDay),
				new SqlParameter("@sp",   c.SuitePrice),
				new SqlParameter("@spd",  c.SuitePerDay),
				new SqlParameter("@flbp",  c.FLResBalconyPrice > 0 ? (object)c.FLResBalconyPrice : DBNull.Value),
				new SqlParameter("@flbpd", c.FLResBalconyPerDay > 0 ? (object)c.FLResBalconyPerDay : DBNull.Value),
				new SqlParameter("@flsp",  c.FLResSuitePrice > 0 ? (object)c.FLResSuitePrice : DBNull.Value),
				new SqlParameter("@flspd", c.FLResSuitePerDay > 0 ? (object)c.FLResSuitePerDay : DBNull.Value),
			}
		}.ExecuteNonQuery();
	}
}

void DumpPriceHistory()
{
	using var conn = new SqlConnection(SqlConnectionString);
	conn.Open();

	var cmd = new SqlCommand(@"
		SELECT
			c.CruiseLine, c.ShipName, c.Itinerary, c.DepartureDate, c.Nights, c.DeparturePort,
			COUNT(p.Id) AS Scrapes,
			MIN(p.BalconyPerDay) AS MinBPD,
			MAX(p.BalconyPerDay) AS MaxBPD,
			(SELECT TOP 1 p2.BalconyPerDay FROM PriceHistory p2
			 WHERE p2.CruiseLine = c.CruiseLine AND p2.ShipName = c.ShipName AND p2.DepartureDate = c.DepartureDate
			 ORDER BY p2.ScrapedAt DESC) AS NowBPD,
			(SELECT TOP 1 p2.SuitePerDay FROM PriceHistory p2
			 WHERE p2.CruiseLine = c.CruiseLine AND p2.ShipName = c.ShipName AND p2.DepartureDate = c.DepartureDate
			 ORDER BY p2.ScrapedAt DESC) AS NowSPD,
			MIN(p.SuitePerDay) AS MinSPD,
			MAX(p.SuitePerDay) AS MaxSPD
		FROM Cruises c
		JOIN PriceHistory p ON p.CruiseLine = c.CruiseLine AND p.ShipName = c.ShipName AND p.DepartureDate = c.DepartureDate
		WHERE c.DepartureDate >= CAST(GETDATE() AS DATE)
		GROUP BY c.CruiseLine, c.ShipName, c.Itinerary, c.DepartureDate, c.Nights, c.DeparturePort
		ORDER BY c.CruiseLine, c.DepartureDate ASC;
	", conn);

	var reader = cmd.ExecuteReader();
	var rows = new List<object>();

	while (reader.Read())
	{
		var minBPD = reader.IsDBNull(7) ? 0m : reader.GetDecimal(7);
		var maxBPD = reader.IsDBNull(8) ? 0m : reader.GetDecimal(8);
		var nowBPD = reader.IsDBNull(9) ? 0m : reader.GetDecimal(9);
		var nowSPD = reader.IsDBNull(10) ? 0m : reader.GetDecimal(10);
		var minSPD = reader.IsDBNull(11) ? 0m : reader.GetDecimal(11);
		var maxSPD = reader.IsDBNull(12) ? 0m : reader.GetDecimal(12);

		var cruiseLine = reader.GetString(0);
		var suiteLabel = cruiseLine == "Norwegian" ? "Haven" : "Suite";

		rows.Add(new
		{
			Line      = cruiseLine,
			Ship      = reader.GetString(1),
			Itinerary = reader.IsDBNull(2) ? "" : reader.GetString(2),
			Departs   = reader.GetDateTime(3).ToString("MMM dd, yyyy"),
			Port      = reader.IsDBNull(5) ? "" : reader.GetString(5),
			Scrapes   = reader.GetInt32(6),
			BalconyPPD = nowBPD > 0 ? nowBPD.ToString("C0") : "N/A",
			BMinMax   = minBPD > 0 ? $"{minBPD:C0}–{maxBPD:C0}" : "N/A",
			BTrend    = nowBPD == 0 ? "" : nowBPD <= minBPD ? "📉 Low!" : nowBPD >= maxBPD ? "📈 High" : "➡️",
			SuitePPD  = nowSPD > 0 ? $"{nowSPD:C0} ({suiteLabel})" : "N/A",
			SMinMax   = minSPD > 0 ? $"{minSPD:C0}–{maxSPD:C0}" : "N/A",
			STrend    = nowSPD == 0 ? "" : nowSPD <= minSPD ? "📉 Low!" : nowSPD >= maxSPD ? "📈 High" : "➡️",
		});
	}

	if (rows.Count > 0)
		rows.Dump("📊 Price Tracking (Balcony & Suite/Haven — $/person/day)");
	else
		"📊  No price history yet — run again tomorrow to start seeing trends!".Dump();
}
