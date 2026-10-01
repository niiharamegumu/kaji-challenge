import { HeadContent, Scripts } from "@tanstack/react-router";
import App from "../App";
import stylesheet from "../tailwind.css?url";
export function Document() {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#f6f4ef" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="KajiChalle" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" href="/icons/pwa-192x192.png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180x180.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="stylesheet" href={stylesheet} />
        <title>KajiChalle</title>
        <style>
          {`
      body {
        margin: 0;
        background: #f6f4ef;
      }

    `}
        </style>
        <HeadContent />
      </head>
      <body>
        <div id="root">
          <App />
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: 'window.performance?.mark?.("boot:html-splash-visible");',
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}
