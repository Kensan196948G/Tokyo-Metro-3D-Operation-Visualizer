/**
 * Rotating "TOKYO METRO FACTS" card (reference v2's #facts). Content is
 * limited to well-established public facts — no invented statistics.
 */
const FACTS: string[] = [
  '銀座線（浅草—上野, 1927年開業）は東洋初の地下鉄。現在も全線が第三軌条方式で走る。',
  '東京メトロは全9路線・180駅（公式値）・総延長約195km。本模型はGTFSデータの174駅を描画。',
  '千代田線・国会議事堂前駅はメトロ有数の深さ（約38m）。地形と路線交差が深さを決める。',
  '銀座線渋谷駅は谷地形のため地上3階に位置する。「地下鉄が空を走る」名物区間。',
  '丸ノ内線は四ツ谷・後楽園付近などで地上に顔を出す。開業1954年、戦後初の新線。',
  '副都心線（2008年開業）はメトロ最新の路線。和光市—渋谷を結び東急東横線と直通する。',
];

export class FactsRotator {
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private bodyEl: HTMLElement,
    private dotsEl: HTMLElement,
    private intervalMs = 9000
  ) {}

  start(): void {
    this.dotsEl.innerHTML = FACTS.map(() => '<i></i>').join('');
    this.render();
    this.timer = setInterval(() => this.next(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private next(): void {
    // Fade out, swap text, fade back in (CSS transition on .fade).
    this.bodyEl.classList.add('fade');
    setTimeout(() => {
      this.index = (this.index + 1) % FACTS.length;
      this.render();
      this.bodyEl.classList.remove('fade');
    }, 500);
  }

  private render(): void {
    this.bodyEl.textContent = FACTS[this.index];
    Array.from(this.dotsEl.children).forEach((dot, i) =>
      dot.classList.toggle('on', i === this.index)
    );
  }
}
