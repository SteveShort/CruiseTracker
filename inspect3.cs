using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;

var client = new HttpClient();
var json = await client.GetStringAsync(""http://localhost:5055/api/cruises"");
var doc = JsonDocument.Parse(json);
var first = doc.RootElement.EnumerateArray().FirstOrDefault();
foreach (var prop in first.EnumerateObject()) {
    Console.WriteLine(prop.Name);
}
