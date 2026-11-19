/* Weitao Lu: portfolio
   One small script for all three pages. Each feature looks for its own markup
   and does nothing when it is not on the page. No dependencies. */

(() => {
    'use strict';

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    /* Home: the black hole is drawn live by js/blackhole.js. If that has not
       managed to start (no WebGL, a machine too slow for it, a script that
       failed to load), show the still capture from the C++ engine instead. -- */

    function initHeroFallback() {
        const sky = document.querySelector('.hero__sky');
        if (!sky || !sky.querySelector('.hero__canvas')) return;

        const useStill = () => {
            if (sky.classList.contains('is-live') || sky.querySelector('.hero__parallax')) return;
            const layer = document.createElement('div');
            layer.className = 'hero__parallax';
            const image = new Image(1980, 1020);
            image.className = 'hero__hole';
            image.alt = '';
            image.src = 'imgs/gargantua-background.png';
            layer.append(image);
            sky.append(layer);
            initParallax();
        };

        // The live render reports its own failures. A script that never loads
        // fires an error instead, and the timer covers anything else.
        window.addEventListener('hero:failed', useStill);
        const script = document.querySelector('script[src$="blackhole.js"]');
        if (script) script.addEventListener('error', useStill);
        else useStill();
        window.setTimeout(useStill, 6000);
    }

    /* Home, still capture only: it leans away from the cursor a little. ----- */

    function initParallax() {
        const layer = document.querySelector('.hero__parallax');
        if (!layer || !finePointer.matches || reducedMotion.matches) return;

        let targetX = 0, targetY = 0, x = 0, y = 0, frame = 0;

        const step = () => {
            x += (targetX - x) * 0.06;
            y += (targetY - y) * 0.06;
            layer.style.setProperty('--px', x.toFixed(4));
            layer.style.setProperty('--py', y.toFixed(4));
            const settled = Math.abs(targetX - x) + Math.abs(targetY - y) < 0.001;
            frame = settled ? 0 : requestAnimationFrame(step);
        };

        window.addEventListener('pointermove', event => {
            targetX = event.clientX / window.innerWidth - 0.5;
            targetY = event.clientY / window.innerHeight - 0.5;
            if (!frame) frame = requestAnimationFrame(step);
        }, { passive: true });
    }

    /* Projects: the masthead shader. ---------------------------------------
       Same idea as the original header: a Voronoi field of drifting points,
       each joined to its near neighbours. Here it is tinted to the palette,
       anti-aliased per device pixel, and paused whenever it is off screen. */

    const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

    const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float u_time;
uniform float u_scale;   // device pixels per CSS pixel

const float CELL = 76.0;        // cell size in CSS pixels
const float PX = 1.0 / CELL;    // one CSS pixel, in cell units
const float REACH = 0.86;       // longest link, in cell units

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Where the point of a given cell sits right now.
vec2 pointIn(vec2 cell) {
    vec2 seed = vec2(hash(cell), hash(cell + 1.0));
    return 0.5 + 0.5 * sin(u_time * 0.3 + 6.2831 * seed);
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 uv = gl_FragCoord.xy / (CELL * u_scale);
    vec2 cell = floor(uv);
    vec2 f = fract(uv);

    // Nearest point.
    float nearest = 8.0;
    vec2 anchor = vec2(0.0);
    vec2 anchorCell = cell;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 offset = vec2(float(i), float(j));
            vec2 point = offset + pointIn(cell + offset);
            float d = length(point - f);
            if (d < nearest) {
                nearest = d;
                anchor = point;
                anchorCell = cell + offset;
            }
        }
    }

    // Links from that point to its neighbours; shorter links glow brighter.
    float web = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 offset = vec2(float(i), float(j));
            vec2 point = offset + pointIn(cell + offset);
            float span = distance(anchor, point);
            if (span > 0.001 && span < REACH) {
                float d = segmentDistance(f, anchor, point);
                float line = 1.0 - smoothstep(0.35 * PX, 1.35 * PX, d);
                web = max(web, line * (1.0 - smoothstep(0.3, REACH, span)));
            }
        }
    }

    float core = 1.0 - smoothstep(1.1 * PX, 2.4 * PX, nearest);
    float halo = exp(-nearest * nearest / (2.0 * 49.0 * PX * PX));

    vec3 gold = vec3(0.91, 0.81, 0.61);
    vec3 blue = vec3(0.71, 0.84, 0.96);
    vec3 tint = mix(gold, blue, step(0.72, hash(anchorCell + 7.0)));

    float alpha = clamp(core * 0.9 + halo * 0.2 + web * 0.3, 0.0, 1.0);
    vec3 colour = mix(tint, vec3(1.0, 0.96, 0.88), core);
    gl_FragColor = vec4(colour * alpha, alpha);   // premultiplied
}`;

    function initShader() {
        const canvas = document.querySelector('.masthead__shader');
        if (!canvas) return;

        const gl = canvas.getContext('webgl', {
            alpha: true,
            antialias: false,
            premultipliedAlpha: true,
            powerPreference: 'low-power'
        });
        if (!gl) return canvas.remove();

        const compile = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
            console.warn('Shader compile failed:', gl.getShaderInfoLog(shader));
            return null;
        };

        const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
        const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        const program = gl.createProgram();
        if (vertex && fragment) {
            gl.attachShader(program, vertex);
            gl.attachShader(program, fragment);
            gl.linkProgram(program);
        }
        if (!vertex || !fragment || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
            return canvas.remove();
        }
        gl.useProgram(program);

        // One oversized triangle covers the whole canvas.
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

        const uTime = gl.getUniformLocation(program, 'u_time');
        const uScale = gl.getUniformLocation(program, 'u_scale');

        const draw = time => {
            const scale = Math.min(window.devicePixelRatio || 1, 2);
            const width = Math.round(canvas.clientWidth * scale);
            const height = Math.round(canvas.clientHeight * scale);
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
                gl.viewport(0, 0, width, height);
            }
            gl.uniform1f(uScale, scale);
            gl.uniform1f(uTime, time * 0.001);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        };

        let frame = 0;
        let onScreen = true;
        const still = 41000;   // the frame shown when motion is reduced

        const loop = time => {
            draw(time);
            frame = requestAnimationFrame(loop);
        };
        const update = () => {
            cancelAnimationFrame(frame);
            frame = 0;
            if (reducedMotion.matches) draw(still);
            else if (onScreen) frame = requestAnimationFrame(loop);
        };

        new IntersectionObserver(entries => {
            onScreen = entries[entries.length - 1].isIntersecting;
            update();
        }).observe(canvas);
        reducedMotion.addEventListener('change', update);
        window.addEventListener('resize', () => {
            if (reducedMotion.matches) draw(still);
        });

        update();
        canvas.closest('.masthead').classList.add('has-shader');
    }

    /* Projects: highlight the tab for the section being read. --------------- */

    function initTabs() {
        const links = Array.from(document.querySelectorAll('.tabs a[href^="#"]'));
        const sections = links
            .map(link => document.getElementById(link.hash.slice(1)))
            .filter(Boolean);
        if (!sections.length) return;

        const list = document.querySelector('.tabs__list');
        const setCurrent = id => {
            links.forEach(link => {
                const current = link.hash === `#${id}`;
                if (current) link.setAttribute('aria-current', 'true');
                else link.removeAttribute('aria-current');
                // Keep the active tab in view when the strip scrolls sideways.
                if (current && list.scrollWidth > list.clientWidth) {
                    list.scrollTo({ left: link.offsetLeft - list.offsetLeft - 24, behavior: 'smooth' });
                }
            });
        };

        // A section is "current" while it crosses a line 40% down the viewport.
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) setCurrent(entry.target.id);
            });
        }, { rootMargin: '-40% 0px -60% 0px' });
        sections.forEach(section => observer.observe(section));
    }

    /* Projects: cover images. ---------------------------------------------- */

    function initMedia() {
        // Covers hosted on itch.io fall back to the local artwork.
        document.querySelectorAll('img[data-fallback]').forEach(image => {
            const swap = () => {
                image.removeEventListener('error', swap);
                image.src = image.dataset.fallback;
                const media = image.closest('.media');
                if (media) media.classList.add('media--contain');
            };
            if (image.complete && image.naturalWidth === 0 && image.currentSrc) swap();
            else image.addEventListener('error', swap);
        });

        // Gameplay GIFs are large, so each loads the first time it is asked for.
        document.querySelectorAll('.media[data-preview]').forEach(media => {
            const toggle = media.querySelector('.media__toggle');
            let gif = null;
            if (toggle) toggle.hidden = false;

            const show = on => {
                if (on && !gif) {
                    gif = new Image();
                    gif.className = 'media__gif';
                    gif.alt = '';
                    gif.decoding = 'async';
                    gif.src = media.dataset.preview;
                    media.querySelector('.media__cover').after(gif);
                }
                media.classList.toggle('is-previewing', on);
                if (toggle) toggle.setAttribute('aria-pressed', String(on));
            };

            if (finePointer.matches) {
                media.addEventListener('pointerenter', () => show(true));
                media.addEventListener('pointerleave', () => show(false));
                if (toggle) {
                    toggle.addEventListener('focus', () => show(true));
                    toggle.addEventListener('blur', () => show(false));
                }
            } else if (toggle) {
                toggle.addEventListener('click', () => show(!media.classList.contains('is-previewing')));
            }
        });
    }

    /* Projects: one dialog for playable builds and full-size screenshots. --- */

    function initTheater() {
        const theater = document.querySelector('.theater');
        if (!theater || typeof theater.showModal !== 'function') return;

        const stage = theater.querySelector('.theater__stage');
        const title = theater.querySelector('.theater__title');
        const external = theater.querySelector('.theater__ext');

        // Unity web builds draw a fixed-size canvas and get cropped in a smaller
        // frame. So the frame is laid out at the build's own size and scaled
        // down to whatever room the window has.
        let build = null;   // { frame, width, height } while a game is open
        const fitBuild = () => {
            if (!build) return;
            const scale = Math.min(
                (window.innerWidth * 0.94) / build.width,
                (window.innerHeight - 150) / build.height,
                1
            );
            stage.style.width = `${Math.floor(build.width * scale)}px`;
            stage.style.height = `${Math.floor(build.height * scale)}px`;
            build.frame.style.transform = `scale(${scale})`;
        };

        const open = (name, content, link) => {
            title.textContent = name;
            external.hidden = !link;
            if (link) external.href = link;
            stage.replaceChildren(content);
            fitBuild();
            theater.showModal();
        };

        // Emptying the stage on close also stops a running game and its audio.
        theater.addEventListener('close', () => {
            build = null;
            stage.replaceChildren();
            stage.removeAttribute('style');
        });
        theater.querySelector('.theater__close').addEventListener('click', () => theater.close());
        theater.addEventListener('click', event => {
            if (event.target === theater) theater.close();   // click on the backdrop
        });
        window.addEventListener('resize', fitBuild);

        document.querySelectorAll('a[data-embed]').forEach(link => {
            link.addEventListener('click', event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                const [width, height] = link.dataset.embed.split('x').map(Number);
                const frame = document.createElement('iframe');
                frame.title = `${link.dataset.title}, playable build`;
                frame.allow = 'autoplay; fullscreen; gamepad';
                frame.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-downloads allow-modals');
                frame.width = width;
                frame.height = height;
                frame.src = link.href;
                build = { frame, width, height };
                open(link.dataset.title, frame, link.dataset.page);
            });
        });

        document.querySelectorAll('a[data-zoom]').forEach(link => {
            link.addEventListener('click', event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                const thumbnail = link.querySelector('img');
                const image = new Image();
                if (thumbnail) {
                    // Same file as the thumbnail, so its size is already known
                    // and the dialog opens at the right shape.
                    image.alt = thumbnail.alt;
                    image.width = thumbnail.naturalWidth || thumbnail.width;
                    image.height = thumbnail.naturalHeight || thumbnail.height;
                }
                image.src = link.href;
                open(link.dataset.zoom, image, null);
            });
        });
    }

    initParallax();
    initHeroFallback();
    initShader();
    initTabs();
    initMedia();
    initTheater();
})();
