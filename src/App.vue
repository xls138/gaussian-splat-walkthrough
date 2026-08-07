<template>
  <canvas ref="canvasRef" id="game"></canvas>
  <div id="app-ui" class="ui" aria-live="polite">
    <div ref="doorPromptsRef" class="door-prompts" aria-hidden="true"></div>

    <HudBar room-title="主展厅" room-state="loading" resource-tier="高画质" />

    <button v-if="fullscreenButtonVisible" class="fullscreen-button" type="button" aria-label="横屏全屏"
      @click="enterLandscapeFullscreen">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 3H3v4" />
        <path d="M13 3h4v4" />
        <path d="M7 17H3v-4" />
        <path d="M13 17h4v-4" />
      </svg>
    </button>

    <!-- @click="toggleMenu" -->
    <button class="menu-button" type="button" aria-label="菜单">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round">
        <line x1="3" y1="5" x2="17" y2="5" />
        <line x1="3" y1="10" x2="17" y2="10" />
        <line x1="3" y1="15" x2="17" y2="15" />
      </svg>
    </button>

    <div v-if="iosInstallPromptVisible" class="ios-install-backdrop" @click.self="dismissIosInstallPrompt">
      <div class="ios-install-card" role="dialog" aria-modal="true" aria-label="添加到主屏幕">
        <button class="ios-install-close" type="button" aria-label="关闭" @click="dismissIosInstallPrompt">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round">
            <line x1="4" y1="4" x2="16" y2="16" />
            <line x1="16" y1="4" x2="4" y2="16" />
          </svg>
        </button>
        <h2>需要添加到主屏幕</h2>
        <p>iOS / iPadOS Safari 不支持网页按钮直接进入真正全屏。请先把 RoomTour 添加到主屏幕，再从主屏幕图标打开，就能以独立全屏窗口运行。</p>
        <ol>
          <li>点击 Safari 底部或顶部的分享按钮</li>
          <li>选择“添加到主屏幕”</li>
          <li>从主屏幕上的 RoomTour 图标重新打开</li>
        </ol>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted, watch, nextTick } from "vue";

import HudBar from "./components/HudBar.vue";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const iosInstallPromptVisible = ref(false);
const fullscreenButtonVisible = ref(true);
let standaloneMedia: MediaQueryList | null = null;

function isAppleMobilePlatform(): boolean {
  const ua = navigator.userAgent;
  const iPhoneOrPad = /iPad|iPhone|iPod/.test(ua);
  const iPadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iPhoneOrPad || iPadDesktopMode;
}

function isStandaloneWebApp(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as any).standalone);
}

function shouldShowIosInstallPrompt(): boolean {
  return isAppleMobilePlatform() && !isStandaloneWebApp();
}

// 是苹果移动设备 且 独立模式,全屏按钮隐藏
function updateFullscreenButtonVisibility(): void {
  fullscreenButtonVisible.value = !(isAppleMobilePlatform() && isStandaloneWebApp());
}

function dismissIosInstallPrompt(): void {
  iosInstallPromptVisible.value = false;
}

async function enterLandscapeFullscreen(): Promise<void> {
  // iOS 安装引导拦截
  if (shouldShowIosInstallPrompt()) {
    iosInstallPromptVisible.value = true;
    return;
  }

  const fullscreenDocument = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  const target = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else {
        await fullscreenDocument.webkitExitFullscreen?.();
      }
      screen.orientation?.unlock?.();
      return;
    }

    if (target.requestFullscreen) {
      await target.requestFullscreen();
    } else {
      await target.webkitRequestFullscreen?.();
    }
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: OrientationLockType) => Promise<void>;
    };
    await orientation.lock?.("landscape").catch(() => undefined);
  } catch {
    // Some mobile browsers only allow fullscreen/orientation lock in limited contexts.
  }
}

onMounted(async () => {
  await nextTick();
  await nextTick();
  updateFullscreenButtonVisibility();
  standaloneMedia = window.matchMedia("(display-mode: standalone)");
  standaloneMedia.addEventListener?.("change", updateFullscreenButtonVisibility);
  document.addEventListener("visibilitychange", updateFullscreenButtonVisibility);

  try {
    if (shouldShowIosInstallPrompt() && localStorage.getItem("gkw-ios-install-dismissed") !== "1") {
      iosInstallPromptVisible.value = true;
      localStorage.setItem("gkw-ios-install-dismissed", "1");
    }
  } catch {
    if (shouldShowIosInstallPrompt()) iosInstallPromptVisible.value = true;
  }

  // watch(
  //   () => touchControlsRef.value,
  //   (tc) => {
  //     if (!tc) return;
  //     setupTouchControls(
  //       tc.stickRef,
  //       tc.knobRef,
  //       tc.crouchRef,
  //       document.querySelector("#start-prompt .start-button") as HTMLElement | null,
  //     );
  //   },
  //   { immediate: true },
  // );
});

onBeforeUnmount(() => {
  standaloneMedia?.removeEventListener?.("change", updateFullscreenButtonVisibility);
  document.removeEventListener("visibilitychange", updateFullscreenButtonVisibility);
});


</script>