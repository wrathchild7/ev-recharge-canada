// Leaflet 1.9.4 Tooltip._source null bug fix
// The bug: when a layer with a tooltip is removed from the map, Leaflet's
// internal DOM event listeners on SVG path elements still fire. The tooltip
// handler tries to access this._source which is already null.
// Fix: wrap L.DomEvent.on so mouse events on SVG elements are try-caught.
(function() {
  if (typeof L === 'undefined' || !L.DomEvent) return;
  var origOn = L.DomEvent.on;
  L.DomEvent.on = function(obj, types, fn, context) {
    if (obj instanceof SVGElement && typeof fn === 'function') {
      var safeFn = function() {
        try { return fn.apply(context || this, arguments); }
        catch(e) {
          if (e.message && e.message.indexOf('_source') !== -1) return;
          throw e;
        }
      };
      return origOn.call(this, obj, types, safeFn, context);
    }
    return origOn.apply(this, arguments);
  };
  // Also patch the alias
  L.DomEvent.addListener = L.DomEvent.on;
})();
