/* eslint-disable consistent-return */
/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
const fs = require("fs");
const path = require("path");
const async = require("async");
const loaderUtils = require("loader-utils");

// Matches only the last occurrence of sourceMappingURL
const baseRegex =
    "\\s*[@#]\\s*sourceMappingURL\\s*=\\s*([^\\s]*)(?![\\S\\s]*sourceMappingURL)",
  // Matches /* ... */ comments
  regex1 = new RegExp("/\\*" + baseRegex + "\\s*\\*/"),
  // Matches // .... comments
  regex2 = new RegExp("//" + baseRegex + "($|\n|\r\n?)"),
  // Matches DataUrls
  regexDataUrl = /data:[^;\n]+(?:;charset=[^;\n]+)?;base64,([a-zA-Z0-9+/]+={0,2})/;

module.exports = function sourceMapLoader(input, inputMap) {
  this.cacheable && this.cacheable();
  const { resolve } = this;
  const { addDependency } = this;
  const emitWarning = this.emitWarning || function emitWarning() {};
  const match = input.match(regex1) || input.match(regex2);
  const callback = this.async();
  if (match) {
    const url = match[1];
    const dataUrlMatch = regexDataUrl.exec(url);
    if (dataUrlMatch) {
      const mapBase64 = dataUrlMatch[1];
      const mapStr = Buffer.from(mapBase64, "base64").toString();
      let map;
      try {
        map = JSON.parse(mapStr);
      } catch (e) {
        emitWarning(
          "Cannot parse inline SourceMap '" +
            mapBase64.substr(0, 50) +
            "': " +
            e
        );
        return untouched();
      }

      processMap(map, this.context, callback);
    } else {
      resolve(
        this.context,
        loaderUtils.urlToRequest(url, true),
        (err, result) => {
          if (err) {
            emitWarning("Cannot find SourceMap '" + url + "': " + err);
            return untouched();
          }

          addDependency(result);
          fs.readFile(result, "utf-8", (err, content) => {
            if (err) {
              emitWarning("Cannot open SourceMap '" + result + "': " + err);
              return untouched();
            }

            let map;
            try {
              map = JSON.parse(content);
            } catch (e) {
              emitWarning("Cannot parse SourceMap '" + url + "': " + e);
              return untouched();
            }

            processMap(map, path.dirname(result), callback);
          });
        }
      );
      return;
    }
  } else {
    return untouched();
  }

  function untouched() {
    callback(null, input, inputMap);
  }

  function processMap(map, context, callback) {
    if (!map.sourcesContent || map.sourcesContent.length < map.sources.length) {
      const sourcePrefix = map.sourceRoot ? map.sourceRoot + "/" : "";
      map.sources = map.sources.map((s) => {
        return sourcePrefix + s;
      });
      delete map.sourceRoot;
      const missingSources = map.sourcesContent
        ? map.sources.slice(map.sourcesContent.length)
        : map.sources;
      async.map(
        missingSources,
        (source, callback) => {
          resolve(
            context,
            loaderUtils.urlToRequest(source, true),
            (err, result) => {
              if (err) {
                emitWarning("Cannot find source file '" + source + "': " + err);
                return callback(null, null);
              }

              addDependency(result);
              fs.readFile(result, "utf-8", (err, content) => {
                if (err) {
                  emitWarning(
                    "Cannot open source file '" + result + "': " + err
                  );
                  return callback(null, null);
                }

                callback(null, {
                  source: result,
                  content,
                });
              });
            }
          );
        },
        (err, info) => {
          map.sourcesContent = map.sourcesContent || [];
          info.forEach((res) => {
            if (res) {
              map.sources[map.sourcesContent.length] = res.source;
              map.sourcesContent.push(res.content);
            } else {
              map.sourcesContent.push(null);
            }
          });
          processMap(map, context, callback);
        }
      );
      return;
    }

    map.sourceRoot = map.sourceRoot || context;
    callback(null, input.replace(match[0], ""), map);
  }
};
