import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/black-ops-one/400.css'
import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'

// Show a scrollbar only while its element scrolls (styled in app.css).
const hideTimers = new WeakMap<Element, number>()
document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target instanceof Element ? e.target : document.documentElement
    el.classList.add('scrolling')
    clearTimeout(hideTimers.get(el))
    hideTimers.set(
      el,
      window.setTimeout(() => el.classList.remove('scrolling'), 800)
    )
  },
  true
)

export default mount(App, { target: document.getElementById('app')! })
