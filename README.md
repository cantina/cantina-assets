Cantina: Assets
============

Asset aggregator and minifier for Cantina applications.

*Cantina Version:* **3.x**

Provides
--------

- **app.assets** - The Assets API

Configuration
-------------

Specify your app's CSS and JS files via `styles` and `scripts` keys,
respectively, in your conf. Then setup how `cantina-assets` should handle them:

```js
{
  "assets": {
    "optimize": "enabled" // Will run all optimizers on `app.start()`
    "css": {
      "foo": { // Custom namespaces allow for multiple aggregates.
        "root": "/path/to/dir"
        "aggregate": true,
        "prefix": true,
        "minify": true,
        "serve": true
        "match": [ // Define an array of RegEx patterns to match files against.
          "^/foo"
        ],
        "exclude": [ // Define an array of RegEx patterns to exclude files.
          "^do",
          "not",
          "want$"
        ]
      }
    },
    "js": {
      "bar": {
        "aggregate": true,
        "minify": true,
        "serve": true
        "match": [
          "^/bar"
        ]
      }
    },
    "templates": {
      "baz": {
        "aggregate": true,
        "minify": false
      }
    }
  }
}
```

Usage
-----

If `app.conf.get('assets:optimize') === 'enabled'` then your assets will be run
through the optimization steps as soon as `app.start()` is called, respecting
all flags per namespace.

API
---

**app.assets.[css|js|templates].aggregate (namespace, cb)**

Aggregates asset files into one file, as per the conf's namespace definition.

**app.assets.[css|js|templates].minify (namespace, cb)**

Minifies asset files (only applies if they are aggregated as well).

**app.assets.css.prefix (namespace, cb)**

Adds certain vendor-prefixes to CSS attributes (only applies if they are aggregated as well).

**app.assets.[css|js|templates].serve (namespace, cb)**

Serves the optimized assets via [dish](https://www.github.com/carlos8f/node-dish) (only applies if they are aggregated as well).

**app.assets.[css|js|templates].[aggregate|minify|prefix|serve]All (cb)**

Runs modifier on all namespaces.

**app.assets.[css|js|templates].optimize (cb)**

Runs all modifiers on all namespaces.

- - -

### Developed by [Terra Eclipse](http://www.terraeclipse.com)
Terra Eclipse, Inc. is a nationally recognized political technology and
strategy firm located in Aptos, CA and Washington, D.C.

- - -

### License: MIT
Copyright (C) 2013 Terra Eclipse, Inc. ([http://www.terraeclipse.com](http://www.terraeclipse.com))

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the &quot;Software&quot;), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
