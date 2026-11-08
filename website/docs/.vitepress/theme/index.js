import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import FaceHero from './components/FaceHero.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  // The homepage mark is the library itself: a live FaceR head rendered with RoostR.
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h(FaceHero),
    });
  },
  enhanceApp({ app }) {
    app.component('FaceHero', FaceHero);
  },
};
