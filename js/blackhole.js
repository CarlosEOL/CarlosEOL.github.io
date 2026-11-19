/* Home page: Gargantua, traced live.

   three.js draws a single full-screen quad and the fragment shader does the
   rest. For every pixel it follows a light ray backwards from the camera
   through Schwarzschild spacetime, so the picture gets its shape from the
   physics: the shadow, the far side of the disk bent up over the top and round
   underneath, and background stars smeared into arcs near the hole. The idea
   is the same as the Render-Engine project's GPU photon tracer.

   Lengths are in Schwarzschild radii (the event horizon has radius 1).

   three.js comes from js/vendor/three.min.js: release r160, unmodified. That
   is the last release published as a plain script rather than only as ES
   modules, and browsers refuse to load modules from a page opened straight
   from disk. It prints a deprecation notice in the console; that is expected.

   If WebGL is missing or anything fails, this announces "hero:failed" and
   js/site.js shows the still capture from the C++ engine instead. */

(() => {
    'use strict';

    const sky = document.querySelector('.hero__sky');
    const canvas = sky && sky.querySelector('.hero__canvas');
    if (!canvas) return;

    const giveUp = error => {
        console.warn(error);
        window.dispatchEvent(new Event('hero:failed'));
    };
    if (!window.THREE) return giveUp(new Error('three.js did not load.'));

    const {
        MathUtils,
        Matrix3,
        Matrix4,
        Mesh,
        OrthographicCamera,
        PlaneGeometry,
        Scene,
        ShaderMaterial,
        Vector2,
        Vector3,
        WebGLRenderer
    } = window.THREE;

    const CAMERA_DISTANCE = 30;
    const DISK_OUTER = 9.6;     // keep in step with DISK_OUT in the shader
    const REST = { tilt: 5, roll: -2 };     // degrees above the disk plane, and camera roll

    const VERTEX_SHADER = /* glsl */ `
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

    const FRAGMENT_SHADER = /* glsl */ `
uniform vec2 uCenter;        // where the hole sits, in drawing-buffer pixels
uniform float uViewHeight;   // drawing-buffer height
uniform float uFocal;        // focal length, in view heights
uniform vec3 uEye;
uniform mat3 uBasis;         // camera right, up, back
uniform float uTime;

const int STEPS = 128;
const float DISK_IN = 2.3;
const float DISK_OUT = 9.6;
const float ESCAPE = 38.0;
const float LOOP = 26.0;     // seconds per texture cycle, see disk()
const float TAU = 6.2831853;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

// Value noise that repeats every "period" cells along x, so it can wrap
// around the disk without a seam.
float ringNoise(vec2 p, float period) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float x0 = mod(cell.x, period);
    float x1 = mod(cell.x + 1.0, period);
    return mix(
        mix(hash21(vec2(x0, cell.y)), hash21(vec2(x1, cell.y)), f.x),
        mix(hash21(vec2(x0, cell.y + 1.0)), hash21(vec2(x1, cell.y + 1.0)), f.x),
        f.y
    );
}

// Long streaks that follow the orbits. "turn" is the angle around the disk
// in whole turns.
float streaks(float r, float turn) {
    float sum = 0.0;
    float gain = 0.5;
    float around = 14.0;
    float outward = 2.2;
    for (int octave = 0; octave < 4; octave++) {
        sum += gain * ringNoise(vec2(turn * around, r * outward), around);
        gain *= 0.5;
        around *= 2.0;
        outward *= 2.3;
    }
    return sum;
}

// Colour and opacity of the disk where a ray crosses it. "rd" is the
// direction the traced ray is travelling; the real photon goes the other way.
vec4 disk(vec3 hit, float r, vec3 rd) {
    float edge = smoothstep(DISK_IN, DISK_IN + 0.8, r) * (1.0 - smoothstep(DISK_OUT - 1.5, DISK_OUT, r));

    // Gas on the left of the picture is coming towards the camera. Doppler
    // beaming makes that side brighter and bluer; gravity reddens all of it.
    vec3 orbit = normalize(vec3(hit.z, 0.0, -hit.x));
    float beta = min(sqrt(0.5 / max(r - 1.0, 0.8)), 0.62);
    float doppler = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(orbit, -rd));
    float shift = doppler * sqrt(1.0 - 1.0 / r);

    // Inner orbits are faster, which would wind the texture up for ever. Two
    // copies run on a loop half a cycle apart and cross-fade, so each is
    // swapped out while it is invisible.
    float turn = atan(hit.z, hit.x) / TAU;
    float omega = 0.55 * pow(r, -1.5);
    float cycle = uTime / LOOP;
    float a = fract(cycle);
    float b = fract(cycle + 0.5);
    float grain = mix(
        streaks(r, turn + omega * a * LOOP),
        streaks(r + 7.3, turn + omega * b * LOOP),
        abs(2.0 * a - 1.0)
    );
    float bands = 0.66 + 0.68 * ringNoise(vec2(0.5, r * 5.0), 8.0);

    // Hotter gas is whiter, then blue; cooler gas falls back to gold and umber.
    // (Linear light: the tone curve in main() softens these.)
    float fade = smoothstep(DISK_IN, DISK_OUT, r);
    float heat = shift * mix(1.0, 0.55, fade);
    vec3 tint = mix(vec3(0.26, 0.15, 0.06), vec3(0.78, 0.56, 0.27), smoothstep(0.28, 0.58, heat));
    tint = mix(tint, vec3(1.0, 0.87, 0.64), smoothstep(0.56, 0.86, heat));
    tint = mix(tint, vec3(0.66, 0.80, 1.12), smoothstep(0.90, 1.30, heat));

    // True beaming goes with a higher power of the shift. This is toned down
    // so the receding side stays readable.
    float power = pow(shift, 1.8) * mix(1.15, 0.62, fade);
    vec3 light = tint * power * (0.18 + 1.45 * pow(grain, 1.25)) * bands * 1.6;
    return vec4(light, edge * clamp(0.62 + 0.8 * grain, 0.0, 1.0));
}

// Procedural stars, looked up by direction.
vec3 sky(vec3 d) {
    vec3 colour = vec3(0.0011, 0.0014, 0.0021);
    // Three layers: a few large stars with a soft halo, then two finer dustings.
    for (int layer = 0; layer < 3; layer++) {
        float scale = layer == 0 ? 26.0 : (layer == 1 ? 52.0 : 96.0);
        float size = layer == 0 ? 0.052 : (layer == 1 ? 0.088 : 0.115);
        float rarity = layer == 0 ? 0.60 : (layer == 1 ? 0.75 : 0.82);
        vec3 p = d * scale + float(layer) * 31.7;
        vec3 cell = floor(p);
        if (hash31(cell) > rarity) {
            vec3 centre = 0.25 + 0.5 * vec3(hash31(cell + 3.1), hash31(cell + 7.7), hash31(cell + 13.3));
            float away = length(fract(p) - centre);
            float core = smoothstep(size, 0.0, away);
            float magnitude = pow(hash31(cell + 21.0), 4.0);   // a few bright, most faint
            vec3 tint = mix(vec3(0.55, 0.70, 1.0), vec3(1.0, 0.90, 0.76), step(0.74, hash31(cell + 5.5)));
            colour += tint * core * core * (0.07 + 1.7 * magnitude);
            if (layer == 0) {
                float halo = smoothstep(0.24, 0.0, away);
                colour += tint * halo * halo * 0.035 * (0.3 + magnitude);
            }
        }
    }
    return colour;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - uCenter) / uViewHeight;
    vec3 p = uEye;
    vec3 v = normalize(uBasis * vec3(uv, -uFocal));

    // Angular momentum is conserved along the ray. With it, light in a
    // Schwarzschild field obeys  x'' = -1.5 * h^2 * x / |x|^5.
    vec3 momentum = cross(p, v);
    float h2 = dot(momentum, momentum);

    vec3 colour = vec3(0.0);
    float through = 1.0;        // how much of what lies behind still shows
    bool captured = false;

    for (int i = 0; i < STEPS; i++) {
        float r2 = dot(p, p);
        if (r2 < 1.0) {
            captured = true;
            break;
        }
        float r = sqrt(r2);

        // Short steps near the hole, long ones far away.
        float dt = r * mix(0.045, 0.105, smoothstep(2.0, 14.0, r));
        v -= 1.5 * h2 * p / (r2 * r2 * r) * dt;
        vec3 next = p + v * dt;

        // Did this step cross the plane of the disk?
        if (p.y * next.y < 0.0) {
            vec3 hit = mix(p, next, p.y / (p.y - next.y));
            float radius = length(hit.xz);
            if (radius > DISK_IN && radius < DISK_OUT) {
                vec4 gas = disk(hit, radius, normalize(v));
                colour += through * gas.rgb * gas.a;
                through *= 1.0 - gas.a;
            }
        }

        p = next;
        if (through < 0.02 || (r > ESCAPE && dot(p, v) > 0.0)) break;
    }

    // Rays still circling the hole when the steps run out count as lost.
    if (!captured && dot(p, p) > 36.0) {
        vec3 glow = vec3(1.0, 0.85, 0.62) * 0.007 / (1.0 + 0.0015 * h2 * h2);
        colour += through * (sky(normalize(v)) + glow);
    }

    colour = 1.0 - exp(-colour * 1.15);
    colour = pow(colour, vec3(0.4545));
    colour += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;      // hides banding in the dark
    gl_FragColor = vec4(colour, 1.0);
}`;

    function start(sky, canvas) {
        const hero = sky.closest('.hero');
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const shortScreen = window.matchMedia('(max-height: 760px) and (min-aspect-ratio: 4 / 3)');

        const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
        let broken = false;
        renderer.debug.onShaderError = () => { broken = true; };

        const uniforms = {
            uCenter: { value: new Vector2() },
            uViewHeight: { value: 1 },
            uFocal: { value: 1.4 },
            uEye: { value: new Vector3() },
            uBasis: { value: new Matrix3() },
            uTime: { value: 0 }
        };
        const material = new ShaderMaterial({
            uniforms,
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            depthTest: false,
            depthWrite: false
        });
        const quad = new Mesh(new PlaneGeometry(2, 2), material);
        quad.frustumCulled = false;
        const scene = new Scene().add(quad);
        const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

        /* Size and placement. The hole sits where the still image did: a little
           above the middle, with the disk most of the way across the short side. */

        // Phones need the extra pixels: the hole is small there, and the thin ring
        // of light around the shadow breaks into dots when it is under-sampled.
        const maxRatio = coarse ? 2 : 1.5;
        const idleGap = coarse ? 30 : 14;       // ms between frames when nothing is moving
        const centre = new Vector2();
        let quality = 1;      // lowered if the GPU cannot keep up
        let ratio = 1;

        const layout = () => {
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (!width || !height) return;
            const short = shortScreen.matches;

            ratio = Math.min(window.devicePixelRatio || 1, maxRatio) * quality;
            renderer.setPixelRatio(ratio);
            renderer.setSize(width, height, false);

            const diskWidth = (short ? 0.74 : 0.86) * Math.min(width, height);
            uniforms.uFocal.value = (diskWidth * CAMERA_DISTANCE) / (2 * DISK_OUTER * height);
            uniforms.uViewHeight.value = height * ratio;
            centre.set(width * 0.5, height * (short ? 0.69 : 0.65));
        };

        /* Camera. */

        const ORIGIN = new Vector3();
        const WORLD_UP = new Vector3(0, 1, 0);
        const eye = new Vector3();
        const right = new Vector3();
        const up = new Vector3();
        const back = new Vector3();
        const look = new Matrix4();

        const aim = (tilt, turn, roll, distance) => {
            tilt = MathUtils.clamp(tilt, -80, 80);
            eye.setFromSphericalCoords(distance, MathUtils.degToRad(90 - tilt), MathUtils.degToRad(turn));
            look.lookAt(eye, ORIGIN, WORLD_UP).extractBasis(right, up, back);
            right.applyAxisAngle(back, MathUtils.degToRad(roll));
            up.applyAxisAngle(back, MathUtils.degToRad(roll));
            uniforms.uEye.value.copy(eye);
            uniforms.uBasis.value.set(
                right.x, up.x, back.x,
                right.y, up.y, back.y,
                right.z, up.z, back.z
            );
        };

        /* Input: the view leans with the cursor, and dragging the sky orbits the
           camera. Letting go eases it back so the title is never left covered. */

        const pointer = { x: 0, y: 0, easedX: 0, easedY: 0 };
        const orbit = { tilt: 0, turn: 0, easedTilt: 0, easedTurn: 0, dragging: false, x: 0, y: 0 };
        let lastInput = -1e9;

        const onPointerMove = event => {
            pointer.x = event.clientX / window.innerWidth - 0.5;
            pointer.y = event.clientY / window.innerHeight - 0.5;
            lastInput = performance.now();
            if (!orbit.dragging) return;
            orbit.turn -= (event.clientX - orbit.x) * 0.3;
            orbit.tilt = MathUtils.clamp(orbit.tilt + (event.clientY - orbit.y) * 0.25, -70, 68);
            orbit.x = event.clientX;
            orbit.y = event.clientY;
        };
        const onPointerDown = event => {
            // Only the open sky starts a drag; text, links and buttons behave normally.
            const onSky = event.target === hero || sky.contains(event.target);
            if (!onSky || event.button !== 0 || event.pointerType === 'touch' || reducedMotion.matches) return;
            orbit.dragging = true;
            orbit.x = event.clientX;
            orbit.y = event.clientY;
            hero.setPointerCapture(event.pointerId);
            hero.classList.add('is-orbiting');
            event.preventDefault();
        };
        const onPointerUp = () => {
            if (!orbit.dragging) return;
            orbit.dragging = false;
            orbit.tilt = 0;
            orbit.turn = 0;
            // Whole turns look the same, so only unwind the remainder.
            orbit.easedTurn = MathUtils.euclideanModulo(orbit.easedTurn + 180, 360) - 180;
            hero.classList.remove('is-orbiting');
        };

        /* Drawing. */

        let time = 0;
        let intro = reducedMotion.matches ? 1 : 0;      // 0 → 1 as the camera settles in
        let live = false;

        const draw = seconds => {
            const follow = 1 - Math.exp(-seconds / (orbit.dragging ? 0.12 : 0.9));
            orbit.easedTilt += (orbit.tilt - orbit.easedTilt) * follow;
            orbit.easedTurn += (orbit.turn - orbit.easedTurn) * follow;
            const lean = 1 - Math.exp(-seconds / 0.35);
            pointer.easedX += (pointer.x - pointer.easedX) * lean;
            pointer.easedY += (pointer.y - pointer.easedY) * lean;

            intro = Math.min(1, intro + seconds / 2.8);
            const arrive = 1 - Math.pow(1 - intro, 3);

            aim(
                REST.tilt + (1 - arrive) * 22 + orbit.easedTilt - pointer.easedY * 5 + Math.sin(time * 0.13) * 0.8,
                orbit.easedTurn + pointer.easedX * 6,
                REST.roll + pointer.easedX * 2.5 + Math.sin(time * 0.09 + 1) * 0.6,
                CAMERA_DISTANCE * (1 + (1 - arrive) * 0.5 + Math.sin(time * 0.07) * 0.015)
            );
            uniforms.uCenter.value.set(
                (centre.x - pointer.easedX * 16) * ratio,
                (centre.y + pointer.easedY * 10) * ratio
            );
            uniforms.uTime.value = time;

            // A lost context comes back by itself; see the listeners below.
            if (renderer.getContext().isContextLost()) return;
            renderer.render(scene, camera);
            if (broken) throw new Error('The black hole shader did not compile.');

            if (!live) {
                live = true;
                sky.classList.add('is-live');
                const canOrbit = canHover && !reducedMotion.matches;
                hero.classList.toggle('is-orbitable', canOrbit);
                if (credit) {
                    credit.textContent = 'Gargantua, traced live with three.js' + (canOrbit ? ' · drag to orbit' : '');
                }
            }
        };

        const credit = document.querySelector('.hero__credit');
        const stillCredit = credit ? credit.textContent : '';

        let frame = 0;
        let dead = false;   // the live render gave up: the still image has taken over
        let visible = true;
        let lastDraw = 0;

        const stop = () => {
            cancelAnimationFrame(frame);
            frame = 0;
        };
        const fail = error => {
            dead = true;
            stop();
            console.warn(error);
            sky.classList.remove('is-live');
            hero.classList.remove('is-orbitable', 'is-orbiting');
            if (credit) credit.textContent = stillCredit;
            window.dispatchEvent(new Event('hero:failed'));
        };
        const render = seconds => {
            if (dead) return;
            try {
                draw(seconds);
            } catch (error) {
                fail(error);
            }
        };

        /* Keeping up. Frames are timed in short windows. If most of a window is
           late, the picture is drawn with fewer pixels; if that makes no
           difference, the display is setting the pace (a 30 fps power-saving mode,
           say) and the pixels go back; and if it is hopeless even at half size,
           the still image takes over. */

        const pace = { time: 0, frames: 0, late: 0, tuning: true, before: 0, qualityBefore: 0 };

        const keepUp = gap => {
            if (!pace.tuning) return;
            pace.time += gap;
            pace.frames += 1;
            if (gap > Math.max(24, idleGap * 1.6)) pace.late += 1;
            if (pace.frames < 4 || pace.time < 800) return;

            const average = pace.time / pace.frames;
            const mostlyLate = pace.late > pace.frames * 0.6;
            pace.time = pace.frames = pace.late = 0;

            if (pace.before) {
                // The last cut should have helped. If not, undo it and stop tuning.
                const helped = average < pace.before * 0.85;
                pace.before = 0;
                if (!helped) {
                    quality = pace.qualityBefore;
                    pace.tuning = false;
                    layout();
                    return;
                }
            }
            if (!mostlyLate) return;
            if (quality > 0.5) {
                pace.before = average;
                pace.qualityBefore = quality;
                quality = Math.max(0.5, quality * Math.max(0.5, Math.sqrt(17 / average)));
                layout();
            } else if (average > 70) {
                fail(new Error('Too slow to trace the black hole live; showing the still capture instead.'));
            }
        };

        const tick = now => {
            frame = requestAnimationFrame(tick);

            // Every frame while something is moving, fewer when idle (60 a second,
            // or 30 on phones, where nothing reacts to a cursor).
            const busy = orbit.dragging || intro < 1 || now - lastInput < 2500 ||
                Math.abs(orbit.easedTilt) + Math.abs(orbit.easedTurn) > 0.05;
            if (!busy && now - lastDraw < idleGap) return;

            if (lastDraw) keepUp(Math.min(now - lastDraw, 1000));
            const seconds = lastDraw ? Math.min((now - lastDraw) / 1000, 0.1) : 0.016;
            lastDraw = now;
            time += seconds;
            render(seconds);
        };

        const resume = () => {
            stop();
            if (dead) return;
            if (reducedMotion.matches) {
                // One still frame, already settled.
                intro = 1;
                render(0);
            } else if (visible && !document.hidden) {
                lastDraw = 0;
                frame = requestAnimationFrame(tick);
            }
        };

        layout();
        new ResizeObserver(() => {
            // Resizing clears the canvas after this frame's draw, so draw again.
            layout();
            if (live) render(0);
        }).observe(canvas);
        new IntersectionObserver(entries => {
            visible = entries[entries.length - 1].isIntersecting;
            resume();
        }).observe(canvas);
        document.addEventListener('visibilitychange', resume);
        reducedMotion.addEventListener('change', resume);

        canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault();
            stop();
        });
        canvas.addEventListener('webglcontextrestored', resume);

        if (canHover) {
            window.addEventListener('pointermove', onPointerMove, { passive: true });
            hero.addEventListener('pointerdown', onPointerDown);
            hero.addEventListener('pointerup', onPointerUp);
            hero.addEventListener('pointercancel', onPointerUp);
        }

        resume();
    }

    try {
        start(sky, canvas);
    } catch (error) {
        giveUp(error);
    }
})();
