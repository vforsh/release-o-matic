export function createRedocHtml(spec: unknown): string {
        const serializedSpec = JSON.stringify(spec)
                .replace(/</g, '\u003c')
                .replace(/-->/g, '--\>')
                .replace(/<\/script/gi, '<\\/script')

        return `<!doctype html>
<html lang="en">
        <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Release-o-matic API docs</title>
                <style>
                        body {
                                margin: 0;
                        }
                        #redoc-container {
                                background: #0f172a;
                                color: #e2e8f0;
                        }
                </style>
        </head>
        <body>
                <div id="redoc-container"></div>
                <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"></script>
                <script>
                        const spec = ${serializedSpec};
                        Redoc.init(spec, {}, document.getElementById('redoc-container'));
                </script>
        </body>
</html>`
}
