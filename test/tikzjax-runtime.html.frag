<script src="./tikzjax-renderer.js"></script>
<link rel="stylesheet" href="./fonts-embedded.css">
<script>
  // Runtime fragment for the end-to-end LaTeX compile test.
  //
  // `tikzjax_default` is the script the test injects on window load; it
  // renders every <script type="text/tikz"> block with the real TikZJax
  // engine and announces the result through the console (the test greps
  // for "Output written on input.dvi").
  window.__rt_ready = true;
  window.tikzjax_default = `
(function(){
  var els = Array.prototype.slice.call(
    document.getElementsByTagName('script')
  ).filter(function(e){ return e.getAttribute('type') === 'text/tikz'; });
  if (typeof window.__tikzjaxRender !== 'function') {
    console.log('TikZJax: renderer not loaded');
    return;
  }
  window.__tikzjaxRender(document.body).then(function(){
    els.forEach(function(){
      document.body.dispatchEvent(
        new CustomEvent('tikzjax-load-finished', { bubbles: true })
      );
    });
  }).catch(function(e){
    console.log('TikZJax: FAILED to compile: ' + String(e));
  });
})();
`;
</script>
