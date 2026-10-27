// Night: 8:30 PM – 6 AM the page is black (and the kiosk may drop the backlight). A tap wakes the
// panel to Today; after the idle time it goes black again (see App idle in app.js).
(function () {
  'use strict';
  App.on('ready', function () {
    // pointerdown, so the waking tap doesn't also land on whatever is under it once it's visible
    App.$('#night').addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); App.wake(); });
  });
})();
