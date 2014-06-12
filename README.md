Cantina: Assets
============

Asset aggregator and minifier for Cantina applications.

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
        "root": "/path/to/dir",
        "dirs": [ // Additional directories from which to fetch "/public" files.
          "/path/to/assets",
          "/another/path"
        ],
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
strategy firm located in Santa Cruz, CA and Washington, D.C.
