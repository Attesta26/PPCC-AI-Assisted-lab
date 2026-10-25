using System;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

public class Script : ScriptBase
{
    private const string UserAgent = "TALXIS-Lab-WarehousePicking/1.0 (+https://github.com/TALXIS/lab)";

    public override async Task<HttpResponseMessage> ExecuteAsync()
    {
        if (string.Equals(Context.OperationId, "GetProductImage", StringComparison.OrdinalIgnoreCase))
        {
            return await GetProductImageAsync().ConfigureAwait(false);
        }

        if (!string.Equals(Context.OperationId, "GetProductByBarcode", StringComparison.OrdinalIgnoreCase))
        {
            return Error(HttpStatusCode.BadRequest, "Unsupported operation");
        }

        SetUserAgent();
        var response = await Context.SendAsync(Context.Request, CancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            return response;
        }

        var body = JObject.Parse(await response.Content.ReadAsStringAsync().ConfigureAwait(false));
        if ((int?)body["status"] != 1)
        {
            response.StatusCode = HttpStatusCode.NotFound;
            response.Content = CreateJsonContent("{\"message\": \"No product found for this barcode\"}");
            return response;
        }

        var product = body["product"] as JObject;
        if (product == null)
        {
            return Error(HttpStatusCode.BadGateway, "Open Food Facts returned an invalid product");
        }

        response.Content = CreateJsonContent(new JObject
        {
            ["ean"] = (string)body["code"] ?? "",
            ["name"] = (string)product["product_name"] ?? "",
            ["brand"] = (string)product["brands"] ?? "",
            ["quantity"] = (string)product["quantity"] ?? "",
            ["imageUrl"] = (string)product["image_url"] ?? ""
        }.ToString());
        return response;
    }

    private async Task<HttpResponseMessage> GetProductImageAsync()
    {
        var imageUrl = GetQueryParameter(Context.Request.RequestUri, "imageUrl");
        if (string.IsNullOrEmpty(imageUrl))
        {
            return Error(HttpStatusCode.BadRequest, "imageUrl query parameter is required");
        }

        // Only proxy the catalog's image host, not arbitrary caller-supplied destinations.
        Uri imageUri;
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out imageUri)
            || imageUri.Scheme != Uri.UriSchemeHttps
            || !string.Equals(imageUri.Host, "images.openfoodfacts.org", StringComparison.OrdinalIgnoreCase)
            || !imageUri.IsDefaultPort
            || !string.IsNullOrEmpty(imageUri.UserInfo))
        {
            return Error(HttpStatusCode.BadRequest, "imageUrl must use https://images.openfoodfacts.org");
        }

        Context.Request.RequestUri = imageUri;
        SetUserAgent();
        return await Context.SendAsync(Context.Request, CancellationToken).ConfigureAwait(false);
    }

    private void SetUserAgent()
    {
        Context.Request.Headers.Remove("User-Agent");
        Context.Request.Headers.UserAgent.ParseAdd(UserAgent);
    }

    private static string GetQueryParameter(Uri requestUri, string name)
    {
        foreach (var pair in requestUri.Query.TrimStart('?').Split('&'))
        {
            var parts = pair.Split(new[] { '=' }, 2);
            if (parts.Length == 2 && Uri.UnescapeDataString(parts[0]) == name)
            {
                return Uri.UnescapeDataString(parts[1].Replace("+", " "));
            }
        }

        return null;
    }

    private static HttpResponseMessage Error(HttpStatusCode status, string message)
    {
        return new HttpResponseMessage(status)
        {
            Content = CreateJsonContent(new JObject { ["message"] = message }.ToString())
        };
    }
}
