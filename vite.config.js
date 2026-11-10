// Relative asset paths, so the built site works wherever it's served from: the root of a
// domain, or a sub-folder such as GitHub Pages (https://<user>.github.io/rain-on-glass/).
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
});
