import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { Theme } from '../lib/theme';

/**
 * Small motion pieces for the app, inspired by Originkit components but drawn natively with
 * react-native-svg and Animated (no WebView, nothing heavy next to the QR). All of them respect the
 * system "reduce motion" setting.
 */

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/**
 * A ring around the QR that drains during the step: at a glance you see when the code changes.
 * `left` and `step` are in seconds; the animation restarts with every new code.
 */
export function QrRing({ codeStep, left, step, theme, children }: { codeStep: number; left: number; step: number; theme: Theme; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const remaining = useRef(new Animated.Value(left / step)).current;
  const STROKE = 4, GAP = 6, RADIUS = 18;

  // A new code: full ring, then drain linearly until the next one.
  useEffect(() => {
    remaining.stopAnimation();
    remaining.setValue(left / step);
    if (reduced) return;
    const a = Animated.timing(remaining, { toValue: 0, duration: left * 1000, easing: Easing.linear, useNativeDriver: false });
    a.start();
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeStep, reduced]);
  // With reduced motion the ring moves once a second, without animation.
  useEffect(() => { if (reduced) remaining.setValue(left / step); }, [left, reduced, remaining, step]);

  const w = box.w + 2 * (GAP + STROKE), h = box.h + 2 * (GAP + STROKE);
  const rw = w - STROKE, rh = h - STROKE;
  const perimeter = 2 * (rw + rh) - (8 - 2 * Math.PI) * RADIUS;
  const offset = remaining.interpolate({ inputRange: [0, 1], outputRange: [perimeter, 0] });

  return (
    <View style={{ padding: GAP + STROKE }}>
      {box.w > 0 ? (
        <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect x={STROKE / 2} y={STROKE / 2} width={rw} height={rh} rx={RADIUS} fill="none" stroke={theme.line} strokeWidth={STROKE} />
          <AnimatedRect x={STROKE / 2} y={STROKE / 2} width={rw} height={rh} rx={RADIUS} fill="none" stroke={theme.primary} strokeWidth={STROKE}
            strokeLinecap="round" strokeDasharray={`${perimeter} ${perimeter}`} strokeDashoffset={offset} />
        </Svg>
      ) : null}
      <View onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>{children}</View>
    </View>
  );
}

/** A tick that draws itself in a disc of the brand colour, with a light "success" vibration. */
export function SuccessCheck({ theme, size = 64 }: { theme: Theme; size?: number }) {
  const reduced = useReducedMotion();
  const draw = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0.6)).current;
  const CHECK = 'M30 51 L44 64 L70 36';
  const LENGTH = 60;
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (reduced) { draw.setValue(1); pop.setValue(1); return; }
    Animated.parallel([
      Animated.spring(pop, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(draw, { toValue: 1, duration: 420, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  }, [draw, pop, reduced]);
  return (
    <Animated.View style={{ transform: [{ scale: pop }] }} accessible={false}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={48} fill={theme.primary} />
        <AnimatedPath d={CHECK} fill="none" stroke={theme.onPrimary} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={`${LENGTH} ${LENGTH}`} strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [LENGTH, 0] })} />
      </Svg>
    </Animated.View>
  );
}

/**
 * The tablet's twinkling squares at the top of the badge card, in the brand colour, fading towards
 * the name. Each square breathes on its own slow loop, run by the native driver: after the start no
 * JavaScript runs per frame, so the QR and its timer are not slowed down. Still with reduced motion.
 */
export function SquaresBand({ theme, height = 64 }: { theme: Theme; height?: number }) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const CELL = 14, FILL = 0.62, MAX_ALPHA = theme.dark ? 0.34 : 0.28;
  const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);

  // Deterministic per square (no jumps on re-render): position, peak brightness, rhythm.
  const squares = useMemo(() => {
    const out: { key: number; x: number; y: number; peak: number; period: number; delay: number }[] = [];
    const rnd = (i: number, a: number, b: number, c: number) => { const v = Math.sin(i * a + b) * c; return v - Math.floor(v); };
    for (let y = 0; y < rows; y++) {
      const envelope = Math.pow(1 - y / rows, 1.8);
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const peak = envelope * (0.35 + 0.65 * rnd(i, 12.9898, 78.233, 43758.5453)) * MAX_ALPHA;
        if (peak < 0.03) continue;
        out.push({ key: i, x: x * CELL + (CELL * (1 - FILL)) / 2, y: y * CELL + (CELL * (1 - FILL)) / 2, peak,
          period: 1400 + rnd(i, 7.137, 33.71, 12345.6789) * 2200, delay: rnd(i, 3.51, 5.91, 9876.54321) * 2400 });
      }
    }
    return out;
  }, [cols, rows, MAX_ALPHA]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {squares.map(({ key, ...q }) => <Twinkle key={key} {...q} size={CELL * FILL} color={theme.primary} still={reduced} />)}
    </View>
  );
}

function Twinkle({ x, y, size, color, peak, period, delay, still }: { x: number; y: number; size: number; color: string; peak: number; period: number; delay: number; still: boolean }) {
  const opacity = useRef(new Animated.Value(peak * 0.6)).current;
  useEffect(() => {
    if (still) { opacity.setValue(peak * 0.6); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: peak, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: peak * 0.12, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const t = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(t); loop.stop(); };
  }, [opacity, peak, period, delay, still]);
  return <Animated.View style={{ position: 'absolute', left: x, top: y, width: size, height: size, backgroundColor: color, opacity }} />;
}

/** Grey rows that breathe while a list loads, shaped like the rows that will replace them. */
export function SkeletonRows({ theme, label, count = 3 }: { theme: Theme; label: string; count?: number }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Animated.View style={{ gap: 8, opacity: pulse }} accessibilityRole="progressbar" accessibilityLabel={label}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[sk.row, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <View style={[sk.block, { width: 48, height: 18, backgroundColor: theme.line }]} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={[sk.block, { width: `${70 - i * 12}%`, height: 14, backgroundColor: theme.line }]} />
            <View style={[sk.block, { width: `${45 + i * 8}%`, height: 11, backgroundColor: theme.line }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const sk = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 64 },
  block: { borderRadius: 6 },
});
