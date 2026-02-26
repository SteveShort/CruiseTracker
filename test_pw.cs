using System;
using System.Threading.Tasks;
using Microsoft.Playwright;

class Program
{
    static async Task Main()
    {
        using var playwright = await Playwright.CreateAsync();
        await using var browser = await playwright.Chromium.LaunchAsync();
        var page = await browser.NewPageAsync();
        
        try {
            await page.GotoAsync("http://localhost/");
            await page.WaitForTimeoutAsync(5000);
            var count = await page.Locator("#dealsContainer .deal-card").CountAsync();
            Console.WriteLine("CARDS: " + count);
            var title = await page.Locator("h1").InnerTextAsync();
            Console.WriteLine("H1: " + title);
        } catch (Exception ex) {
            Console.WriteLine("ERR: " + ex.Message);
        }
    }
}
