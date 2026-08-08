<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  open: boolean;
  renderQuality: "low" | "medium" | "high";
  lookSensitivity: number;
  minimapEnabled: boolean;
  debugModeEnabled: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "update:renderQuality": [value: "low" | "medium" | "high"];
  "update:lookSensitivity": [value: number];
  "update:minimapEnabled": [value: boolean];
  "update:debugModeEnabled": [value: boolean];
}>();

const isDesktop = computed(() => matchMedia("(pointer: fine)").matches);
const pendingQuality = ref<"low" | "medium" | "high" | null>(null);

const qualityOptions = [
  { value: "low" as const, label: "低" },
  { value: "medium" as const, label: "中" },
  { value: "high" as const, label: "高" },
];

const sensitivityMin = 0.06;
const sensitivityMax = 0.24;
const sensitivityStep = 0.005;
const sensitivityPercent = computed(() => {
  const progress = (props.lookSensitivity - sensitivityMin) / (sensitivityMax - sensitivityMin);
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
});

function selectQuality(value: "low" | "medium" | "high") {
  if (value === props.renderQuality) return;
  if (isRiskyQuality(value)) {
    pendingQuality.value = value;
    return;
  }
  emit("update:renderQuality", value);
}

function isRiskyQuality(value: "low" | "medium" | "high"): boolean {
  if (isDesktop.value) return value === "high";
  return value === "medium" || value === "high";
}

function confirmQualityChange(): void {
  if (!pendingQuality.value) return;
  emit("update:renderQuality", pendingQuality.value);
  pendingQuality.value = null;
}

function cancelQualityChange(): void {
  pendingQuality.value = null;
}

function setSensitivity(event: Event) {
  const input = event.target as HTMLInputElement;
  emit("update:lookSensitivity", Number(input.value));
}

function setMinimap(value: boolean) {
  emit("update:minimapEnabled", value);
}

function setDebugMode(value: boolean) {
  emit("update:debugModeEnabled", value);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="settings-fade">
      <div v-if="open" class="settings-backdrop" @click.self="emit('close')">
        <Transition name="settings-slide">
          <div
            v-if="open"
            :class="['settings-panel', isDesktop ? 'settings-drawer' : 'settings-popover']"
            role="dialog"
            aria-modal="true"
            aria-label="菜单"
          >
            <button class="settings-close" type="button" aria-label="关闭菜单" @click="emit('close')">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="3" y1="3" x2="17" y2="17" />
                <line x1="17" y1="3" x2="3" y2="17" />
              </svg>
            </button>

            <div class="settings-content">
              <h1 class="settings-heading">关于</h1>

              <section class="settings-section">
                <div class="settings-about">
                  <h3 class="settings-app-name">Company RoomTour</h3>
                  <p class="settings-app-desc">
                    基于 Gaussian Splatting 的实景漫游原型，支持第一人称移动、碰撞检测和房间切换。
                  </p>
                  <div class="settings-meta">
                    <span>PlayCanvas</span>
                    <span>Gaussian Splatting</span>
                  </div>
                </div>
              </section>
                
              <h2 class="settings-heading">游戏设置</h2>

              <section class="settings-section">
                <div class="settings-quality">
                  <p class="settings-label">渲染精度</p>
                  <div class="quality-options">
                    <button
                      v-for="opt in qualityOptions"
                      :key="opt.value"
                      :class="['quality-option', { active: renderQuality === opt.value }]"
                      type="button"
                      @click="selectQuality(opt.value)"
                    >
                      {{ opt.label }}
                    </button>
                  </div>
                  <p class="settings-hint muted">
                    切换后将重新加载当前房间的模型文件
                  </p>
                </div>
              </section>

              <section class="settings-section">
                <div class="settings-quality">
                  <p class="settings-label">视角灵敏度</p>
                  <div class="sensitivity-slider">
                    <input
                      class="sensitivity-range"
                      type="range"
                      :min="sensitivityMin"
                      :max="sensitivityMax"
                      :step="sensitivityStep"
                      :value="lookSensitivity"
                      @input="setSensitivity"
                    />
                    <div class="sensitivity-slider-meta">
                      <span>低</span>
                      <strong>{{ sensitivityPercent }}%</strong>
                      <span>高</span>
                    </div>
                  </div>
                </div>
              </section>

              <section class="settings-section">
                <div class="settings-quality">
                  <p class="settings-label">小地图</p>
                  <div class="quality-options">
                    <button
                      :class="['quality-option', { active: minimapEnabled }]"
                      type="button"
                      @click="setMinimap(true)"
                    >
                      显示
                    </button>
                    <button
                      :class="['quality-option', { active: !minimapEnabled }]"
                      type="button"
                      @click="setMinimap(false)"
                    >
                      隐藏
                    </button>
                  </div>
                  <p class="settings-hint muted">
                    开启后会在画面右上角显示当前房间位置和朝向。
                  </p>
                </div>
              </section>

              <section class="settings-section">
                <div class="settings-quality">
                  <p class="settings-label">调试模式</p>
                  <div class="quality-options">
                    <button
                      :class="['quality-option', { active: debugModeEnabled }]"
                      type="button"
                      @click="setDebugMode(true)"
                    >
                      显示
                    </button>
                    <button
                      :class="['quality-option', { active: !debugModeEnabled }]"
                      type="button"
                      @click="setDebugMode(false)"
                    >
                      隐藏
                    </button>
                  </div>
                  <p class="settings-hint muted">
                    开启后显示当前渲染分辨率和帧率。
                  </p>
                </div>
              </section>

              <div style="height: 20px;"></div>
            </div>
          </div>
        </Transition>

          <div v-if="pendingQuality" class="quality-warning-backdrop">
            <div class="quality-warning-dialog" role="alertdialog" aria-modal="true" aria-label="渲染精度提示">
              <p class="quality-warning-text">该设置可能导致设备压力过大，加载时间变长，是否继续？</p>
              <div class="quality-warning-actions">
                <button class="quality-warning-button secondary" type="button" @click="cancelQualityChange">
                  取消
                </button>
                <button class="quality-warning-button primary" type="button" @click="confirmQualityChange">
                  继续
                </button>
              </div>
            </div>
          </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(5, 6, 6, 0.48);
  pointer-events: auto;
}

.settings-panel {
  position: fixed;
  z-index: 101;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(28, 31, 30, 0.88);
  -webkit-backdrop-filter: blur(30px) saturate(132%);
  backdrop-filter: blur(30px) saturate(132%);
  color: #fff;
  overflow-y: auto;
  display: flex;
  flex-direction: column;

  &::-webkit-scrollbar {
    background-color: transparent;
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.6);
    border-radius: 100px;
  }
}

.settings-drawer {
  top: 0;
  right: 0;
  bottom: 0;
  width: min(420px, 92vw);
  border-left: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.28);
}

.settings-popover {
  inset: max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
}

.settings-close {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 50%;
  background: rgba(70, 74, 72, 0.72);
  -webkit-backdrop-filter: blur(30px) saturate(132%);
  backdrop-filter: blur(30px) saturate(132%);
  color: #fff;
  cursor: pointer;
  transition: background 180ms ease;
  padding: 0;
}

.settings-close:hover {
  background: rgba(84, 88, 86, 0.78);
}

.settings-content {
  flex: 1;
  padding: 28px 24px 36px;
  min-height: 0;
}

.settings-section {
  margin-bottom: 16px;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-heading {
  margin: 0 0 16px;
  font-size: 24px;
  font-weight: 200;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.56);
  text-transform: uppercase;
}

.settings-about {
  padding: 18px;
  border-radius: 12px;
  background: rgba(70, 74, 72, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.settings-app-name {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
}

.settings-app-desc {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.68);
}

.settings-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-meta span {
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.64);
}

.settings-quality {
  padding: 18px;
  border-radius: 12px;
  background: rgba(70, 74, 72, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.settings-label {
  margin-top: 0;
  font-size: 14px;
  font-weight: 700;
}

.quality-options {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.sensitivity-range {
  width: 100%;
  height: 28px;
  margin: 0;
  accent-color: #8ff4df;
  cursor: pointer;
}

.sensitivity-slider-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.56);
  font-size: 12px;
  font-weight: 600;
}

.sensitivity-slider-meta strong {
  color: rgba(255, 255, 255, 0.86);
  font-size: 13px;
}

.quality-option {
  flex: 1;
  min-height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 999px;
  background: rgba(70, 74, 72, 0.48);
  -webkit-backdrop-filter: blur(24px) saturate(132%);
  backdrop-filter: blur(24px) saturate(132%);
  color: rgba(255, 255, 255, 0.82);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, color 180ms ease;
  padding: 0 12px;
}

.quality-option:hover {
  background: rgba(84, 88, 86, 0.64);
  border-color: rgba(255, 255, 255, 0.4);
}

.quality-option.active {
  background: rgba(255, 255, 255, 0.92);
  border-color: #fff;
  color: #1c1f1e;
}

.settings-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.56);
}

.settings-hint.muted {
  color: rgba(255, 255, 255, 0.36);
}

.quality-warning-backdrop {
  left: 0;
  top: 0;
  position: fixed;
  inset: 0;
  z-index: 102;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(16, 0, 0, 0.28);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.quality-warning-dialog {
  width: min(380px, 100%);
  border: 1px solid rgba(255, 82, 82, 0.96);
  border-radius: 12px;
  background: rgba(128, 12, 12, 0.74);
  -webkit-backdrop-filter: blur(26px) saturate(132%);
  backdrop-filter: blur(26px) saturate(132%);
  box-shadow: 0 0 0 1px rgba(255, 82, 82, 0.42), 0 0 30px rgba(255, 0, 0, 0.4), 0 18px 48px rgba(0, 0, 0, 0.42);
  padding: 22px;
}

.quality-warning-text {
  margin: 0 0 18px;
  color: rgba(255, 255, 255, 0.94);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.6;
}

.quality-warning-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.quality-warning-button {
  min-width: 82px;
  min-height: 38px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.quality-warning-button.secondary {
  background: rgba(255, 255, 255, 0.12);
}

.quality-warning-button.primary {
  border-color: rgba(255, 170, 170, 0.9);
  background: rgba(255, 46, 46, 0.44);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 240ms ease;
}

.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}

.settings-slide-enter-active {
  transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

.settings-slide-leave-active {
  transition: transform 180ms cubic-bezier(0.4, 0, 1, 1);
}

.settings-drawer.settings-slide-enter-from,
.settings-drawer.settings-slide-leave-to {
  transform: translateX(100%);
}

.settings-popover.settings-slide-enter-from,
.settings-popover.settings-slide-leave-to {
  transform: scale(0.95);
  opacity: 0;
}
</style>
