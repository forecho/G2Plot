import { registerShape } from '@antv/g2';
import { IGroup } from '@antv/g-base';
import { reduce, isNumber, mix } from '@antv/util';
import { transform } from '../../../utils/matrix';
import { Point } from '../../../types';

function lerp(a: number, b: number, factor: number) {
  return (1 - factor) * a + factor * b;
}

/**
 * 波浪的 attrs
 * @param cfg
 */
function getFillAttrs(cfg) {
  const attrs = { opacity: 1, ...cfg.style };

  if (cfg.color && !attrs.fill) {
    attrs.fill = cfg.color;
  }

  return attrs;
}

/**
 * 圆圈的 attrs
 * @param cfg
 */
function getLineAttrs(cfg) {
  const defaultAttrs = {
    fill: '#fff',
    fillOpacity: 0,
    lineWidth: 2,
  };
  const attrs = mix({}, defaultAttrs, cfg.style);

  if (cfg.color && !attrs.stroke) {
    attrs.stroke = cfg.color;
  }
  if (isNumber(cfg.opacity)) {
    attrs.opacity = attrs.strokeOpacity = cfg.opacity;
  }

  return attrs;
}

/**
 * 用贝塞尔曲线模拟正弦波
 * Using Bezier curves to fit sine wave.
 * There is 4 control points for each curve of wave,
 * which is at 1/4 wave length of the sine wave.
 *
 * The control points for a wave from (a) to (d) are a-b-c-d:
 *          c *----* d
 *     b *
 *       |
 * ... a * ..................
 *
 * whose positions are a: (0, 0), b: (0.5, 0.5), c: (1, 1), d: (PI / 2, 1)
 *
 * @param x          x position of the left-most point (a)
 * @param stage      0-3, stating which part of the wave it is
 * @param waveLength wave length of the sine wave
 * @param amplitude  wave amplitude
 * @return 正弦片段曲线
 */
function getWaterWavePositions(x: number, stage: number, waveLength: number, amplitude: number) {
  if (stage === 0) {
    return [
      [x + ((1 / 2) * waveLength) / Math.PI / 2, amplitude / 2],
      [x + ((1 / 2) * waveLength) / Math.PI, amplitude],
      [x + waveLength / 4, amplitude],
    ];
  }
  if (stage === 1) {
    return [
      [x + (((1 / 2) * waveLength) / Math.PI / 2) * (Math.PI - 2), amplitude],
      [x + (((1 / 2) * waveLength) / Math.PI / 2) * (Math.PI - 1), amplitude / 2],
      [x + waveLength / 4, 0],
    ];
  }
  if (stage === 2) {
    return [
      [x + ((1 / 2) * waveLength) / Math.PI / 2, -amplitude / 2],
      [x + ((1 / 2) * waveLength) / Math.PI, -amplitude],
      [x + waveLength / 4, -amplitude],
    ];
  }
  return [
    [x + (((1 / 2) * waveLength) / Math.PI / 2) * (Math.PI - 2), -amplitude],
    [x + (((1 / 2) * waveLength) / Math.PI / 2) * (Math.PI - 1), -amplitude / 2],
    [x + waveLength / 4, 0],
  ];
}
/**
 * 获取水波路径
 * @param radius          半径
 * @param waterLevel      水位
 * @param waveLength      波长
 * @param phase           相位
 * @param amplitude       震幅
 * @param cx              圆心x
 * @param cy              圆心y
 * @return path            路径
 * @reference http://gitlab.alipay-inc.com/datavis/g6/blob/1.2.0/src/graph/utils/path.js#L135
 */
function getWaterWavePath(
  radius: number,
  waterLevel: number,
  waveLength: number,
  phase: number,
  amplitude: number,
  cx: number,
  cy: number
) {
  const curves = Math.ceil(((2 * radius) / waveLength) * 4) * 2;
  const path = [];
  let _phase = phase;

  // map phase to [-Math.PI * 2, 0]
  while (_phase < -Math.PI * 2) {
    _phase += Math.PI * 2;
  }
  while (_phase > 0) {
    _phase -= Math.PI * 2;
  }
  _phase = (_phase / Math.PI / 2) * waveLength;

  const left = cx - radius + _phase - radius * 2;
  /**
   * top-left corner as start point
   *
   * draws this point
   *  |
   * \|/
   *  ~~~~~~~~
   *  |      |
   *  +------+
   */
  path.push(['M', left, waterLevel]);

  /**
   * top wave
   *
   * ~~~~~~~~ <- draws this sine wave
   * |      |
   * +------+
   */
  let waveRight = 0;
  for (let c = 0; c < curves; ++c) {
    const stage = c % 4;
    const pos = getWaterWavePositions((c * waveLength) / 4, stage, waveLength, amplitude);
    path.push([
      'C',
      pos[0][0] + left,
      -pos[0][1] + waterLevel,
      pos[1][0] + left,
      -pos[1][1] + waterLevel,
      pos[2][0] + left,
      -pos[2][1] + waterLevel,
    ]);

    if (c === curves - 1) {
      waveRight = pos[2][0];
    }
  }

  /**
   * top-right corner
   *
   *                       ~~~~~~~~
   * 3. draws this line -> |      | <- 1. draws this line
   *                       +------+
   *                          ^
   *                          |
   *                  2. draws this line
   */
  path.push(['L', waveRight + left, cy + radius]);
  path.push(['L', left, cy + radius]);
  path.push(['Z']);
  // path.push(['L', left, waterLevel]);
  return path;
}

/**
 * 添加水波
 * @param x           中心x
 * @param y           中心y
 * @param level       水位等级 0～1
 * @param waveCount   水波数
 * @param waveAttrs      色值
 * @param group       图组
 * @param clip        用于剪切的图形
 * @param radius      绘制图形的高度
 */
function addWaterWave(x, y, level, waveCount, waveAttrs, group, clip, radius) {
  const { fill, opacity } = waveAttrs;
  const bbox = clip.getBBox();
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const duration = 5000;
  for (let i = 0; i < waveCount; i++) {
    const factor = waveCount <= 1 ? 0 : i / (waveCount - 1);
    const wave = group.addShape('path', {
      name: `wave-path-${i}`,
      attrs: {
        path: getWaterWavePath(radius, bbox.minY + height * level, width / 4, 0, width / lerp(56, 64, factor), x, y),
        fill,
        opacity: lerp(0.6, 0.3, factor) * opacity,
      },
    });

    try {
      const matrix = transform([['t', width / 2, 0]]);
      wave.animate(
        { matrix },
        {
          duration: lerp(duration, 0.7 * duration, factor),
          repeat: true,
        }
      );
    } catch (e) {
      // TODO off-screen canvas 中动画会找不到 canvas
      console.error('off-screen group animate error!');
    }
  }
}

registerShape('interval', 'liquid-fill-gauge', {
  draw(cfg: any, container: IGroup) {
    const cx = 0.5;
    const cy = 0.5;

    // 需要更好的传参方式
    const radio = isNumber(cfg.customInfo.radius) ? cfg.customInfo.radius : 0.9;

    // 获取最小 minX
    const minX = reduce(
      cfg.points as Point[],
      (r: number, p: Point) => {
        return Math.min(r, p.x);
      },
      Infinity
    );

    const center = this.parsePoint({ x: cx, y: cy });
    const minXPoint = this.parsePoint({ x: minX, y: cy });
    const halfWidth = center.x - minXPoint.x;

    // 保证半径是 画布宽高最小值的 radius 值
    const radius = Math.min(halfWidth, minXPoint.y * radio);
    const waveAttrs = getFillAttrs(cfg);

    const waves = container.addGroup({
      name: 'waves',
    });

    waves.setClip({
      type: 'circle',
      attrs: {
        x: center.x,
        y: center.y,
        r: radius,
      },
    });
    const clipCircle = waves.get('clipShape');
    addWaterWave(
      center.x,
      center.y,
      1 - (cfg.points[1] as Point).y, // cfg.y / (2 * cp.y),
      3,
      waveAttrs,
      waves,
      clipCircle,
      radius * 4
    );

    container.addShape('circle', {
      name: 'wrap',
      attrs: mix(getLineAttrs(cfg), {
        x: center.x,
        y: center.y,
        r: radius,
        fill: 'transparent',
      }),
    });

    return container;
  },
});
