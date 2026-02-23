<Query Kind="Program">
  <NuGetReference>HtmlAgilityPack</NuGetReference>
  <Namespace>HtmlAgilityPack</Namespace>
  <Namespace>System.Net.Http</Namespace>
</Query>

// Walk pages using &pg=N for both Disney and Norwegian

async Task Main()
{
	using var client = CreateHttpClient();
	
	"1️⃣ Warming up cookies...".Dump();
	try
	{
		await client.GetAsync("https://www.cruise.com/");
		await Task.Delay(1500);
		await client.GetAsync("https://cs.cruise.com/");
		await Task.Delay(2000);
	}
	catch { }

	// Test Disney first (vid=582), then Norwegian (vid=624)
	var tests = new[] {
		("Disney", "https://cs.cruise.com/cs/forms/CruiseResultPage.aspx?skin=1&phone=888-333-3116&lid=en&did=1&vid=582&nr=y&mon=-1"),
		("Norwegian", "https://cs.cruise.com/cs/forms/CruiseResultPage.aspx?skin=1&phone=888-333-3116&lid=en&did=1&vid=624&nr=y&mon=-1"),
	};

	foreach (var (name, baseUrl) in tests)
	{
		$"\n═══ {name} ═══".Dump();
		
		for (int pg = 1; pg <= 5; pg++) // just test first 5 pages
		{
			var url = pg == 1 ? baseUrl : baseUrl + $"&pg={pg}";
			await Task.Delay(800);
			
			try
			{
				var resp = await client.GetAsync(url);
				var html = await resp.Content.ReadAsStringAsync();
				
				if (html.Contains("Incapsula", StringComparison.OrdinalIgnoreCase) && html.Length < 5000)
				{
					$"   Page {pg}: ❌ Incapsula blocked ({html.Length} chars)".Dump();
					break;
				}
				
				var doc = new HtmlDocument();
				doc.LoadHtml(html);
				
				var articles = doc.DocumentNode.SelectNodes("//article[contains(@class,'crCruiseListing')]");
				var count = articles?.Count ?? 0;
				
				if (count == 0)
				{
					$"   Page {pg}: 0 articles — END".Dump();
					break;
				}
				
				// Get first and last ship names to verify different content
				var firstShip = articles.First().SelectSingleNode(".//div[contains(@class,'crVendorCruise')]/span")?.InnerText?.Trim() ?? "?";
				var lastShip = articles.Last().SelectSingleNode(".//div[contains(@class,'crVendorCruise')]/span")?.InnerText?.Trim() ?? "?";
				
				// Get first itinerary
				var firstItin = articles.First().SelectSingleNode(".//h3[contains(@class,'crLengthDestination')]")?.InnerText?.Trim() ?? "?";
				var lastItin = articles.Last().SelectSingleNode(".//h3[contains(@class,'crLengthDestination')]")?.InnerText?.Trim() ?? "?";
				
				// Check paging div
				var pagingDiv = doc.DocumentNode.SelectSingleNode("//div[contains(@class,'crPaging')]");
				var pagingInfo = pagingDiv != null ? pagingDiv.InnerText.Trim().Substring(0, Math.Min(60, pagingDiv.InnerText.Trim().Length)) : "NO crPaging div";
				
				$"   Page {pg}: {count} articles | First: {firstShip} / {firstItin} | Last: {lastShip} / {lastItin} | Paging: {pagingInfo}".Dump();
			}
			catch (Exception ex)
			{
				$"   Page {pg}: Error — {ex.Message}".Dump();
			}
		}
	}
	
	"\n✅ Done!".Dump();
}

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
	client.DefaultRequestHeaders.Add("Referer", "https://www.cruise.com/");
	client.DefaultRequestHeaders.Add("Sec-Fetch-Dest", "document");
	client.DefaultRequestHeaders.Add("Sec-Fetch-Mode", "navigate");
	client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "same-site");

	return client;
}
