const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outputHtmlPath = path.join(repoRoot, "api", "openapi.html");

const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KajiChalle API</title>
  <style>
    body {
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  <redoc spec-url="./openapi.yaml"></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>
`;

fs.writeFileSync(outputHtmlPath, html);
console.log(`wrote ${path.relative(repoRoot, outputHtmlPath)}`);
