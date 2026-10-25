using System.Net;
using System.Text;
using Newtonsoft.Json.Linq;

const string userAgent = "TALXIS-Lab-WarehousePicking/1.0 (+https://github.com/TALXIS/lab)";
var count = 0;

void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
    Console.WriteLine($"PASS: {name}");
    count++;
}

async Task<HttpResponseMessage> Run(string operation, string query, HttpResponseMessage backend)
{
    var context = new TestContext(operation, query, backend);
    var response = await new Script { Context = context }.ExecuteAsync();
    if (context.Sent)
    {
        Check(context.Request.Headers.UserAgent.ToString() == userAgent, "required User-Agent");
    }
    return response;
}

var found = await Run("GetProductByBarcode", "", new HttpResponseMessage(HttpStatusCode.OK)
{
    Content = new StringContent("""{"status":1,"code":"3017620422003","product":{"product_name":"Nutella","brands":"Nutella, Ferrero","quantity":"400 g e","image_url":"https://images.openfoodfacts.org/nutella.jpg"}}""")
});
var product = JObject.Parse(await found.Content.ReadAsStringAsync());
Check((string)product["ean"] == "3017620422003", "barcode maps from code");
Check((string)product["name"] == "Nutella", "name flattened");
Check((string)product["brand"] == "Nutella, Ferrero", "brand flattened");
Check((string)product["quantity"] == "400 g e", "quantity remains text");
Check((string)product["imageUrl"] == "https://images.openfoodfacts.org/nutella.jpg", "image flattened");

var missing = await Run("GetProductByBarcode", "", new HttpResponseMessage(HttpStatusCode.OK)
{
    Content = new StringContent("""{"status":0}""")
});
Check(missing.StatusCode == HttpStatusCode.NotFound, "unknown barcode is 404");
Check((string)JObject.Parse(await missing.Content.ReadAsStringAsync())["message"] == "No product found for this barcode", "exact missing-product message");

var upstream = new HttpResponseMessage(HttpStatusCode.TooManyRequests) { Content = new StringContent("retry later") };
Check(ReferenceEquals(await Run("GetProductByBarcode", "", upstream), upstream), "non-success response passed through unchanged");
var optional = await Run("GetProductByBarcode", "", new HttpResponseMessage(HttpStatusCode.OK)
{
    Content = new StringContent("""{"status":1,"code":"123","product":{}}""")
});
Check((string)JObject.Parse(await optional.Content.ReadAsStringAsync())["name"] == "", "absent optional catalog text stays a string");
var malformed = await Run("GetProductByBarcode", "", new HttpResponseMessage(HttpStatusCode.OK)
{
    Content = new StringContent("""{"status":1,"code":"123"}""")
});
Check(malformed.StatusCode == HttpStatusCode.BadGateway, "invalid product is explicit failure");

foreach (var query in new[] { "", "?imageUrl=" })
{
    var context = new TestContext("GetProductImage", query, null);
    var response = await new Script { Context = context }.ExecuteAsync();
    Check(response.StatusCode == HttpStatusCode.BadRequest && !context.Sent, "missing image never calls backend");
    Check((string)JObject.Parse(await response.Content.ReadAsStringAsync())["message"] == "imageUrl query parameter is required", "exact missing-image message");
}

var imageUrl = "https://images.openfoodfacts.org/images/products/test.jpg?x=1&y=2";
var bytes = new byte[] { 0xff, 0xd8, 0xff, 0xe0 };
var image = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
image.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
var imageContext = new TestContext("GetProductImage", "?imageUrl=" + Uri.EscapeDataString(imageUrl), image);
var imageResponse = await new Script { Context = imageContext }.ExecuteAsync();
Check(imageContext.Request.RequestUri.AbsoluteUri == imageUrl, "encoded image URL decoded once");
Check(imageContext.Request.Headers.UserAgent.ToString() == userAgent, "image User-Agent");
Check((await imageResponse.Content.ReadAsByteArrayAsync()).SequenceEqual(bytes), "image bytes unchanged");
Check(imageResponse.Content.Headers.ContentType.MediaType == "image/jpeg", "image content type unchanged");

foreach (var url in new[] { "http://images.openfoodfacts.org/a", "https://example.com/a", "https://images.openfoodfacts.org.evil.test/a", "https://user@images.openfoodfacts.org/a", "https://images.openfoodfacts.org:8443/a", "not a url" })
{
    var context = new TestContext("GetProductImage", "?imageUrl=" + Uri.EscapeDataString(url), null);
    var response = await new Script { Context = context }.ExecuteAsync();
    Check(response.StatusCode == HttpStatusCode.BadRequest && !context.Sent, "invalid image destination rejected: " + url);
}
var unknown = new TestContext("OtherOperation", "", null);
Check((await new Script { Context = unknown }.ExecuteAsync()).StatusCode == HttpStatusCode.BadRequest && !unknown.Sent, "unknown operation rejected");
Console.WriteLine($"{count} checks passed.");

public abstract class ScriptBase
{
    public TestContext Context { get; set; }
    public CancellationToken CancellationToken { get; set; }
    public abstract Task<HttpResponseMessage> ExecuteAsync();
    public static StringContent CreateJsonContent(string text) => new(text, Encoding.UTF8, "application/json");
}

public sealed class TestContext(string operation, string query, HttpResponseMessage backend)
{
    public string OperationId => operation;
    public HttpRequestMessage Request { get; } = new(HttpMethod.Get, "https://world.openfoodfacts.org/api/v2/product-image" + query);
    public bool Sent { get; private set; }
    public Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Sent = true;
        return Task.FromResult(backend ?? throw new InvalidOperationException("Unexpected backend call"));
    }
}
