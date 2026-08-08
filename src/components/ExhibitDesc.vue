<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  visible: boolean;
  title: string;
  time: string;
  description: string;
  image: string | string[];
  url: string;
}>();

const emit = defineEmits<{ close: [] }>();

const selectedImageIndex = ref(0);
const previewOpen = ref(false);
const previewImageLoading = ref(false);
const touchStartX = ref<number | null>(null);
const touchStartY = ref<number | null>(null);
const zoom = ref(1);
const panX = ref(0);
const panY = ref(0);
const isPanning = ref(false);
const panStartX = ref(0);
const panStartY = ref(0);
const panOriginX = ref(0);
const panOriginY = ref(0);
const isPinching = ref(false);
const pinchStartDistance = ref(0);
const pinchStartZoom = ref(1);
const pinchStartCenterX = ref(0);
const pinchStartCenterY = ref(0);
const pinchOriginX = ref(0);
const pinchOriginY = ref(0);
const didPreviewGesture = ref(false);
const activePointers = new Map<number, { x: number; y: number }>();
let previewImageToken = 0;

const linkUrl = computed(() => props.url.trim());
const exhibitTime = computed(() => props.time.trim());
const hasDescription = computed(() => props.description.trim().length > 0);
const descriptionLines = computed(() => props.description.split("\n"));
const images = computed(() => {
  const source = Array.isArray(props.image) ? props.image : [props.image];
  return source.map((item) => item.trim()).filter(Boolean);
});
const hasImages = computed(() => images.value.length > 0);
const coverImage = computed(() => images.value[0] ?? "");
const selectedImage = computed(() => images.value[selectedImageIndex.value] ?? "");
const imageTransform = computed(() => `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`);
const imageClass = computed(() => ({
  zoomed: zoom.value > 1,
  moving: isPanning.value || isPinching.value,
}));
const imageFileName = computed(() => {
  const fallback = `${props.title || "exhibit"}.jpg`;
  if (!selectedImage.value) return fallback;
  const clean = selectedImage.value.split("?")[0].split("#")[0];
  return decodeURIComponent(clean.split("/").pop() || fallback);
});

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      previewOpen.value = false;
      selectedImageIndex.value = 0;
      resetPreviewView();
    }
  },
);

watch(images, (nextImages) => {
  if (selectedImageIndex.value >= nextImages.length) selectedImageIndex.value = 0;
});

watch(selectedImage, () => {
  resetPreviewView();
});

watch([previewOpen, selectedImage], () => {
  updatePreviewImageLoading();
});

function openLink(): void {
  if (!linkUrl.value) return;
  window.open(linkUrl.value, "_blank", "noopener,noreferrer");
}

function selectImage(index: number): void {
  selectedImageIndex.value = Math.max(0, Math.min(index, images.value.length - 1));
}

function openPreview(index = 0): void {
  if (!images.value.length) return;
  selectImage(index);
  resetPreviewView();
  previewOpen.value = true;
}

function closePreview(): void {
  previewOpen.value = false;
  previewImageLoading.value = false;
  resetPreviewView();
}

function showPreviousImage(): void {
  if (images.value.length <= 1) return;
  selectedImageIndex.value = (selectedImageIndex.value - 1 + images.value.length) % images.value.length;
  resetPreviewView();
}

function showNextImage(): void {
  if (images.value.length <= 1) return;
  selectedImageIndex.value = (selectedImageIndex.value + 1) % images.value.length;
  resetPreviewView();
}

function resetPreviewView(): void {
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
  isPanning.value = false;
  isPinching.value = false;
  didPreviewGesture.value = false;
  activePointers.clear();
}

function setZoom(nextZoom: number): void {
  zoom.value = Math.max(1, Math.min(3, nextZoom));
  if (zoom.value === 1) {
    panX.value = 0;
    panY.value = 0;
  }
}

function zoomIn(): void {
  setZoom(zoom.value + 0.35);
}

function zoomOut(): void {
  setZoom(zoom.value - 0.35);
}

function toggleZoom(): void {
  setZoom(zoom.value > 1 ? 1 : 2);
}

function pointerList(): Array<{ x: number; y: number }> {
  return Array.from(activePointers.values());
}

function pointerDistance(points = pointerList()): number {
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function pointerCenter(points = pointerList()): { x: number; y: number } {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  return {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  };
}

function startPan(point: { x: number; y: number }): void {
  if (zoom.value <= 1) return;
  isPanning.value = true;
  panStartX.value = point.x;
  panStartY.value = point.y;
  panOriginX.value = panX.value;
  panOriginY.value = panY.value;
}

function startPinch(): void {
  const points = pointerList();
  if (points.length < 2) return;
  isPinching.value = true;
  isPanning.value = false;
  didPreviewGesture.value = true;
  pinchStartDistance.value = Math.max(pointerDistance(points), 1);
  pinchStartZoom.value = zoom.value;
  const center = pointerCenter(points);
  pinchStartCenterX.value = center.x;
  pinchStartCenterY.value = center.y;
  pinchOriginX.value = panX.value;
  pinchOriginY.value = panY.value;
}

function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Pointer capture may fail if the browser already cancelled this pointer.
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.releasePointerCapture?.(pointerId);
  } catch {
    // Ignore stale pointer captures on mobile browsers.
  }
}

function downloadImage(): void {
  if (!selectedImage.value) return;
  const link = document.createElement("a");
  link.href = selectedImage.value;
  link.download = imageFileName.value;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function updatePreviewImageLoading(): void {
  const src = selectedImage.value;
  previewImageToken += 1;
  const token = previewImageToken;
  if (!previewOpen.value || !src) {
    previewImageLoading.value = false;
    return;
  }

  const probe = new Image();
  probe.src = src;
  if (probe.complete && probe.naturalWidth > 0) {
    previewImageLoading.value = false;
    return;
  }

  previewImageLoading.value = true;
  probe.onload = () => {
    if (token === previewImageToken) previewImageLoading.value = false;
  };
  probe.onerror = () => {
    if (token === previewImageToken) previewImageLoading.value = false;
  };
}

function handlePreviewImageLoad(): void {
  previewImageLoading.value = false;
}

function handlePreviewImageError(): void {
  previewImageLoading.value = false;
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.visible || !previewOpen.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closePreview();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    showPreviousImage();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    showNextImage();
  } else if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomIn();
  } else if (event.key === "-") {
    event.preventDefault();
    zoomOut();
  } else if (event.key === "0") {
    event.preventDefault();
    resetPreviewView();
  }
}

function handlePointerDown(event: PointerEvent): void {
  event.preventDefault();
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  capturePointer(event.currentTarget as HTMLElement, event.pointerId);
  touchStartX.value = event.clientX;
  touchStartY.value = event.clientY;
  didPreviewGesture.value = false;
  if (activePointers.size >= 2) {
    startPinch();
  } else {
    startPan({ x: event.clientX, y: event.clientY });
  }
}

function handlePointerMove(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (isPinching.value && activePointers.size >= 2) {
    event.preventDefault();
    const points = pointerList();
    const distance = Math.max(pointerDistance(points), 1);
    const center = pointerCenter(points);
    const nextZoom = Math.max(1, Math.min(3, pinchStartZoom.value * (distance / pinchStartDistance.value)));
    zoom.value = nextZoom;
    if (nextZoom === 1) {
      panX.value = 0;
      panY.value = 0;
    } else {
      panX.value = pinchOriginX.value + center.x - pinchStartCenterX.value;
      panY.value = pinchOriginY.value + center.y - pinchStartCenterY.value;
    }
    return;
  }
  if (!isPanning.value || zoom.value <= 1) return;
  event.preventDefault();
  didPreviewGesture.value = true;
  panX.value = panOriginX.value + event.clientX - panStartX.value;
  panY.value = panOriginY.value + event.clientY - panStartY.value;
}

function handlePointerUp(event: PointerEvent): void {
  activePointers.delete(event.pointerId);
  releasePointer(event.currentTarget as HTMLElement, event.pointerId);
  if (isPinching.value) {
    isPinching.value = false;
    if (activePointers.size === 1) startPan(pointerList()[0]);
    return;
  }
  if (isPanning.value) {
    isPanning.value = false;
    touchStartX.value = null;
    touchStartY.value = null;
    return;
  }
  if (didPreviewGesture.value) return;
  if (touchStartX.value === null || touchStartY.value === null) return;
  const dx = event.clientX - touchStartX.value;
  const dy = event.clientY - touchStartY.value;
  touchStartX.value = null;
  touchStartY.value = null;
  if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
  if (dx > 0) showPreviousImage();
  else showNextImage();
}

function handlePointerCancel(event: PointerEvent): void {
  activePointers.delete(event.pointerId);
  releasePointer(event.currentTarget as HTMLElement, event.pointerId);
  if (!activePointers.size) {
    isPanning.value = false;
    isPinching.value = false;
  }
}

function handleWheel(event: WheelEvent): void {
  event.preventDefault();
  setZoom(zoom.value + (event.deltaY < 0 ? 0.25 : -0.25));
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Transition name="exhibit-fade">
    <div v-if="visible" class="exhibit-desc-backdrop" @click.self="emit('close')">
      <div :class="['exhibit-desc-card', { 'has-image': hasImages, 'has-description': hasDescription, 'no-description': !hasDescription }]">
        <button class="exhibit-desc-close" type="button" aria-label="关闭" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="3" y1="3" x2="17" y2="17" />
            <line x1="17" y1="3" x2="3" y2="17" />
          </svg>
        </button>
        <div class="exhibit-desc-body">
          <div v-if="hasImages" class="exhibit-gallery">
            <button class="exhibit-image-button" type="button" aria-label="打开图片预览" @click="openPreview(0)">
              <img :src="coverImage" class="exhibit-desc-image" alt="" />
              <span v-if="images.length > 1" class="exhibit-image-count">{{ images.length }}</span>
            </button>
          </div>
          <div class="exhibit-desc-text-col">
            <div class="exhibit-desc-heading">
              <div class="exhibit-desc-title">
                {{ title }}
              </div>
              <div v-if="exhibitTime" class="exhibit-desc-time">
                {{ exhibitTime }}
              </div>
            </div>
            <div v-if="hasDescription || linkUrl" class="exhibit-desc-text-col-scroll">
              <div v-if="hasDescription" class="exhibit-desc-text">
                <p class="exhibit-desc-text-p" v-for="(line, index) in descriptionLines" :key="index">
                  {{ line }}
                </p>
              </div>
              <button v-if="linkUrl" class="exhibit-desc-link" type="button" @click="openLink">
                <span>打开链接</span>
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M7 13L13 7" />
                  <path d="M8 7h5v5" />
                  <path d="M13 13v3H4V7h3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <p class="exhibit-desc-hint">按 E 或点击空白处关闭</p>
      </div>

      <Transition name="preview-fade">
        <div v-if="previewOpen" class="image-preview" @click.self="closePreview">
          <div class="image-preview-toolbar">
            <span>{{ selectedImageIndex + 1 }} / {{ images.length }}</span>
            <button type="button" @click="zoomOut">缩小</button>
            <button type="button" @click="zoomIn">放大</button>
            <button type="button" @click="resetPreviewView">重置</button>
            <button type="button" @click="downloadImage">下载</button>
            <button type="button" aria-label="关闭预览" @click="closePreview">关闭</button>
          </div>
          <button v-if="images.length > 1" class="preview-nav prev" type="button" aria-label="上一张" @click="showPreviousImage">
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 4L6 10l6 6" />
            </svg>
          </button>
          <div v-if="previewImageLoading" class="image-preview-loading" role="status" aria-label="图片加载中">
            <span class="image-preview-spinner" aria-hidden="true"></span>
          </div>
          <img
            :src="selectedImage"
            :class="['image-preview-image', imageClass, { loading: previewImageLoading }]"
            :style="{ transform: imageTransform }"
            alt=""
            @load="handlePreviewImageLoad"
            @error="handlePreviewImageError"
            @pointerdown="handlePointerDown"
            @pointermove="handlePointerMove"
            @pointerup="handlePointerUp"
            @pointercancel="handlePointerCancel"
            @lostpointercapture="handlePointerCancel"
            @dblclick="toggleZoom"
            @wheel="handleWheel"
          />
          <button v-if="images.length > 1" class="preview-nav next" type="button" aria-label="下一张" @click="showNextImage">
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 4l6 6-6 6" />
            </svg>
          </button>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.exhibit-desc-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 6, 6, 0.56);
  -webkit-backdrop-filter: blur(12px) saturate(120%);
  backdrop-filter: blur(12px) saturate(120%);
  pointer-events: auto;
  padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
}

.exhibit-desc-card {
  position: relative;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 16px;
  background: rgba(28, 31, 30, 0.92);
  -webkit-backdrop-filter: blur(30px) saturate(132%);
  backdrop-filter: blur(30px) saturate(132%);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
  color: #fff;
  padding: 32px 28px;
}

.exhibit-desc-card:not(.has-image) {
  max-width: 480px;
}

.exhibit-desc-card.has-image {
  max-width: 760px;
}

.exhibit-desc-card.no-description.has-image {
  max-width: 440px;
}

.exhibit-desc-close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
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

.exhibit-desc-close:hover {
  background: rgba(84, 88, 86, 0.78);
}

.exhibit-desc-body {
  display: flex;
  gap: 24px;
  max-height: 80vh;
}

.exhibit-desc-card.no-description .exhibit-desc-body {
  flex-direction: column;
  gap: 16px;
  max-height: min(80vh, 640px);
}

.exhibit-gallery {
  width: 360px;
  flex: 0 0 auto;
}

.exhibit-desc-card.no-description .exhibit-gallery {
  width: 100%;
}

.exhibit-image-button {
  position: relative;
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  cursor: zoom-in;
  padding: 0;
}

.exhibit-desc-image {
  display: block;
  width: 100%;
  height: 270px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  object-fit: cover;
}

.exhibit-image-count {
  position: absolute;
  right: 10px;
  bottom: 10px;
  min-width: 34px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.56);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  line-height: 26px;
  text-align: center;
}

.exhibit-desc-text-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-y: hidden;
  margin-bottom: 12px;
}

.exhibit-desc-card.no-description .exhibit-desc-text-col {
  align-items: center;
  margin-bottom: 0;
  overflow: visible;
  text-align: center;
}

.exhibit-desc-text-col-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;

  &::-webkit-scrollbar {
    display: none;
  }
}

.exhibit-desc-heading {
  margin: 0;
  position: sticky;
  top: 0;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  border-radius: 12px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  padding: 8px 10px;
  box-sizing: border-box;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.25;
  z-index: 1;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.045) 42%, rgba(255, 255, 255, 0.08)),
    var(--surface);
  -webkit-backdrop-filter: var(--ui-blur);
  backdrop-filter: var(--ui-blur);
  will-change: backdrop-filter;
}

.exhibit-desc-title {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.25;
}

.exhibit-desc-time {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.58);
}

.exhibit-desc-card.no-description .exhibit-desc-heading {
  position: static;
  align-items: center;
  width: 100%;
  margin-bottom: 0;
  padding: 0 8px;
  background: transparent;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.exhibit-desc-card.no-description .exhibit-desc-title {
  font-size: 22px;
}

.exhibit-desc-card.no-description .exhibit-desc-time {
  order: -1;
  color: rgba(255, 255, 255, 0.48);
}

.exhibit-desc-text {
  margin: 0;
  height: 100%;
  font-size: 14px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.76);
}

.exhibit-desc-text-p {
  margin-top: 0;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.76);
  margin-bottom: 5px;
  line-height: 1.7;

  &:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }
}

.exhibit-desc-link {
  position: absolute;
  right: 28px;
  bottom: 22px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 15px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  -webkit-backdrop-filter: blur(24px) saturate(132%);
  backdrop-filter: blur(24px) saturate(132%);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.exhibit-desc-link:hover {
  border-color: rgba(255, 255, 255, 0.36);
  background: rgba(255, 255, 255, 0.18);
  transform: translateY(-1px);
}

.exhibit-desc-link svg {
  flex: 0 0 auto;
}

.exhibit-desc-card.no-description .exhibit-desc-link {
  position: static;
  margin-top: 4px;
}

.exhibit-desc-hint {
  margin: 0;
  margin-top: 12px;
  font-size: 11px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.32);
}

.image-preview {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.84);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  padding: max(64px, env(safe-area-inset-top)) max(72px, env(safe-area-inset-right)) max(46px, env(safe-area-inset-bottom)) max(72px, env(safe-area-inset-left));
}

.image-preview-image {
  display: block;
  max-width: min(100%, 1280px);
  max-height: 100%;
  border-radius: 10px;
  object-fit: contain;
  touch-action: none;
  user-select: none;
  cursor: zoom-in;
  transition: transform 120ms ease;
}

.image-preview-image.loading {
  opacity: 0;
}

.image-preview-image.zoomed {
  cursor: grab;
}

.image-preview-image.moving {
  cursor: grabbing;
  transition: none;
}

.image-preview-toolbar {
  position: absolute;
  top: max(16px, env(safe-area-inset-top));
  right: max(16px, env(safe-area-inset-right));
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
}

.image-preview-toolbar button,
.preview-nav {
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  color: #fff;
  cursor: pointer;
}

.image-preview-toolbar button {
  min-height: 34px;
  padding: 0 12px;
}

.preview-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 44px;
  height: 56px;
  transform: translateY(-50%);
}

.preview-nav.prev {
  left: max(18px, env(safe-area-inset-left));
}

.preview-nav.next {
  right: max(18px, env(safe-area-inset-right));
}

.image-preview-loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.image-preview-spinner {
  width: 44px;
  height: 44px;
  border: 3px solid rgba(255, 255, 255, 0.18);
  border-top-color: rgba(255, 255, 255, 0.86);
  border-radius: 50%;
  animation: image-preview-spin 780ms linear infinite;
}

@keyframes image-preview-spin {
  to {
    transform: rotate(360deg);
  }
}

.exhibit-fade-enter-active,
.preview-fade-enter-active {
  transition: opacity 240ms ease;
}

.exhibit-fade-leave-active,
.preview-fade-leave-active {
  transition: opacity 180ms ease;
}

.exhibit-fade-enter-from,
.exhibit-fade-leave-to,
.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}

.exhibit-fade-enter-active .exhibit-desc-card {
  transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

.exhibit-fade-leave-active .exhibit-desc-card {
  transition: transform 180ms cubic-bezier(0.4, 0, 1, 1);
}

.exhibit-fade-enter-from .exhibit-desc-card,
.exhibit-fade-leave-to .exhibit-desc-card {
  transform: scale(0.95) translateY(12px);
}

@media (max-width: 680px), (pointer: coarse) {
  .exhibit-desc-backdrop {
    padding: max(18px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  }

  .exhibit-desc-card,
  .exhibit-desc-card.has-image {
    max-width: 480px;
    padding: 24px;
  }

  .exhibit-desc-body {
    flex-direction: column;
    gap: 16px;
  }

  .exhibit-gallery {
    width: 100%;
  }

  .exhibit-desc-image {
    height: auto;
    aspect-ratio: 4 / 3;
  }

  .exhibit-desc-title {
    font-size: 18px;
  }

  .exhibit-desc-card.no-description .exhibit-desc-title {
    font-size: 20px;
  }

  .exhibit-desc-text {
    font-size: 13px;
  }

  .exhibit-desc-link {
    right: 20px;
    bottom: 18px;
  }

  .image-preview {
    padding: max(76px, env(safe-area-inset-top)) 14px max(34px, env(safe-area-inset-bottom));
  }

  .image-preview-toolbar {
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    flex-wrap: wrap;
    justify-content: center;
  }

  .preview-nav {
    display: none;
  }
}

@media (pointer: coarse) and (orientation: landscape) {
  .exhibit-desc-card.has-image {
    max-width: min(760px, calc(100vw - 34px));
  }

  .exhibit-desc-card.no-description.has-image {
    max-width: 440px;
  }

  .exhibit-desc-body {
    flex-direction: row;
    max-height: calc(100vh - 150px);
  }

  .exhibit-desc-card.no-description .exhibit-desc-body {
    flex-direction: column;
    max-height: min(80vh, 640px);
  }

  .exhibit-gallery {
    width: 38%;
  }

  .exhibit-desc-card.no-description .exhibit-gallery {
    width: 100%;
  }
}
</style>
