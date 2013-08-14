Cantina: Assets
============

Asset compiler, aggregator, and minifier for Cantina applications.

*Cantina Version:* **3.x**

Provides
--------

- **app.assets** - The Assets API

Configuration
-------------

Though you can manually schedule jobs via the api, the more common way to setup
your's app's jobs is through your configuration.

```js
{
  "assets": {
    "optimize": "enabled"
    "css": {
      "foo": {
        "aggregate": true,
        "minify": true,
        "serve": true
        "match": [
          "^/foo"
        ]
      }
      },
      "bar": {
        "aggregate": true,
        "prefix": true,
        "minify": true,
        "serve": true,
        "match": [
          "^/bar",
          "baz$"
        ],
        "exclude": [
          "thing"
        ]
      }
    }
    },
    "js": {
      "foo": {
        "aggregate": true,
        "minify": true,
        "serve": true
        "match": [
          "^/foo"
        ]
      }
    },
    "templates": {
      "all": {
        "aggregate": true,
        "minify": false
      }
    }
  }
}
```

Usage
-----

If `app.conf.get('assets:optimize') === 'enabled'` then you assets will be run
through the optimization steps as soon as `app.start()` is called, respecting
all flags per namespace.

API
---

**app.assets.[css|js|templates].aggregate (namespace, cb)**

Aggregates asset files as per the conf's namespace definition.

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
