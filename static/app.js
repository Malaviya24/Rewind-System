document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-confirm]").forEach((form) => {
        form.addEventListener("submit", (event) => {
            const message = form.getAttribute("data-confirm") || "Are you sure?";
            if (!window.confirm(message)) {
                event.preventDefault();
            }
        });
    });

    document.querySelectorAll(".toast").forEach((toast) => {
        const close = toast.querySelector(".toast-close");
        const removeToast = () => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(12px)";
            setTimeout(() => toast.remove(), 180);
        };

        close?.addEventListener("click", removeToast);
        setTimeout(removeToast, 4200);
    });

    const imageInput = document.querySelector("#image:not([data-logo-input])");
    const preview = document.querySelector("[data-image-preview]");

    if (imageInput && preview) {
        imageInput.addEventListener("change", () => {
            const file = imageInput.files && imageInput.files[0];
            if (!file) {
                return;
            }

            const image = document.createElement("img");
            image.alt = "Selected motor image";
            image.src = URL.createObjectURL(file);
            image.onload = () => URL.revokeObjectURL(image.src);
            preview.replaceChildren(image);
        });
    }

    const logoInput = document.querySelector("[data-logo-input]");
    const logoPreview = document.querySelector("[data-image-preview]");
    const logoCropOutput = document.querySelector("[data-logo-crop-output]");
    const logoCropModal = document.querySelector("[data-logo-crop-modal]");
    if (logoInput && logoPreview && logoCropOutput && logoCropModal) {
        const stage = logoCropModal.querySelector("[data-logo-crop-stage]");
        const cropImage = logoCropModal.querySelector("[data-logo-crop-image]");
        const zoomInput = logoCropModal.querySelector("[data-logo-crop-zoom]");
        const applyButton = logoCropModal.querySelector("[data-logo-crop-apply]");
        const cancelButtons = logoCropModal.querySelectorAll("[data-logo-crop-cancel]");
        let objectUrl = "";
        let naturalWidth = 0;
        let naturalHeight = 0;
        let baseWidth = 0;
        let baseHeight = 0;
        let offsetX = 0;
        let offsetY = 0;
        let dragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let startOffsetX = 0;
        let startOffsetY = 0;

        const closeCropper = () => {
            logoCropModal.hidden = true;
            document.body.classList.remove("logo-crop-open");
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                objectUrl = "";
            }
        };

        const cropSize = () => Math.min(stage?.clientWidth || 320, stage?.clientHeight || 320);

        const clampOffsets = () => {
            const size = cropSize();
            const zoom = Number(zoomInput?.value || 1);
            const width = baseWidth * zoom;
            const height = baseHeight * zoom;
            const limitX = Math.max(0, (width - size) / 2);
            const limitY = Math.max(0, (height - size) / 2);
            offsetX = Math.min(limitX, Math.max(-limitX, offsetX));
            offsetY = Math.min(limitY, Math.max(-limitY, offsetY));
        };

        const updateCropImage = () => {
            if (!cropImage) {
                return;
            }
            clampOffsets();
            const zoom = Number(zoomInput?.value || 1);
            cropImage.style.width = `${baseWidth}px`;
            cropImage.style.height = `${baseHeight}px`;
            cropImage.style.transform = `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
        };

        logoInput.addEventListener("change", () => {
            const file = logoInput.files && logoInput.files[0];
            if (!file || !cropImage || !stage || !zoomInput) {
                return;
            }
            if (!file.type.startsWith("image/")) {
                return;
            }
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
            objectUrl = URL.createObjectURL(file);
            cropImage.onload = () => {
                naturalWidth = cropImage.naturalWidth;
                naturalHeight = cropImage.naturalHeight;
                const size = cropSize();
                const coverScale = Math.max(size / naturalWidth, size / naturalHeight);
                baseWidth = naturalWidth * coverScale;
                baseHeight = naturalHeight * coverScale;
                offsetX = 0;
                offsetY = 0;
                zoomInput.value = "1";
                updateCropImage();
            };
            cropImage.src = objectUrl;
            logoCropOutput.value = "";
            logoCropModal.hidden = false;
            document.body.classList.add("logo-crop-open");
        });

        zoomInput?.addEventListener("input", updateCropImage);

        stage?.addEventListener("pointerdown", (event) => {
            dragging = true;
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            startOffsetX = offsetX;
            startOffsetY = offsetY;
            stage.setPointerCapture(event.pointerId);
        });

        stage?.addEventListener("pointermove", (event) => {
            if (!dragging) {
                return;
            }
            offsetX = startOffsetX + event.clientX - dragStartX;
            offsetY = startOffsetY + event.clientY - dragStartY;
            updateCropImage();
        });

        const stopDragging = (event) => {
            dragging = false;
            try {
                stage?.releasePointerCapture(event.pointerId);
            } catch {
                // Pointer may already be released by the browser.
            }
        };
        stage?.addEventListener("pointerup", stopDragging);
        stage?.addEventListener("pointercancel", stopDragging);

        applyButton?.addEventListener("click", () => {
            if (!cropImage || !naturalWidth || !naturalHeight) {
                return;
            }
            const size = cropSize();
            const zoom = Number(zoomInput?.value || 1);
            const displayedWidth = baseWidth * zoom;
            const displayedHeight = baseHeight * zoom;
            const imageLeft = size / 2 + offsetX - displayedWidth / 2;
            const imageTop = size / 2 + offsetY - displayedHeight / 2;
            const sx = Math.max(0, (-imageLeft / displayedWidth) * naturalWidth);
            const sy = Math.max(0, (-imageTop / displayedHeight) * naturalHeight);
            const sw = Math.min(naturalWidth - sx, (size / displayedWidth) * naturalWidth);
            const sh = Math.min(naturalHeight - sy, (size / displayedHeight) * naturalHeight);
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            const context = canvas.getContext("2d");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(cropImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL("image/png");
            logoCropOutput.value = dataUrl;

            const previewImage = document.createElement("img");
            previewImage.alt = "Cropped shop logo";
            previewImage.src = dataUrl;
            logoPreview.replaceChildren(previewImage);
            closeCropper();
        });

        cancelButtons.forEach((button) => {
            button.addEventListener("click", () => {
                logoInput.value = "";
                closeCropper();
            });
        });
    }

    const mediaInput = document.querySelector("#media");
    const mediaPreview = document.querySelector("[data-media-preview]");
    if (mediaInput && mediaPreview) {
        mediaInput.addEventListener("change", () => {
            const files = Array.from(mediaInput.files || []);
            if (!files.length) {
                mediaPreview.replaceChildren(document.createTextNode("No new media selected"));
                return;
            }

            const grid = document.createElement("div");
            grid.className = "media-preview-grid";
            files.forEach((file) => {
                const card = document.createElement("div");
                card.className = "media-preview-card";
                const url = URL.createObjectURL(file);
                if (file.type.startsWith("video/")) {
                    const video = document.createElement("video");
                    video.src = url;
                    video.controls = true;
                    video.muted = true;
                    video.preload = "metadata";
                    video.onloadeddata = () => URL.revokeObjectURL(url);
                    card.appendChild(video);
                } else {
                    const image = document.createElement("img");
                    image.alt = file.name;
                    image.src = url;
                    image.onload = () => URL.revokeObjectURL(url);
                    card.appendChild(image);
                }
                const label = document.createElement("span");
                label.textContent = file.name;
                card.appendChild(label);
                grid.appendChild(card);
            });
            mediaPreview.replaceChildren(grid);
        });
    }

    document.querySelectorAll("[data-phone-input]").forEach((input) => {
        const normalizePhone = () => {
            input.value = (input.value || "").replace(/\D/g, "").slice(0, 10);
            input.setCustomValidity("");
        };
        input.addEventListener("input", normalizePhone);
        input.addEventListener("paste", () => window.setTimeout(normalizePhone, 0));
        input.closest("form")?.addEventListener("submit", (event) => {
            normalizePhone();
            if (input.required && input.value.length !== 10) {
                input.setCustomValidity("Enter exactly 10 digits.");
            } else if (input.value && input.value.length !== 10) {
                input.setCustomValidity("Enter exactly 10 digits or leave it blank.");
            } else {
                input.setCustomValidity("");
            }
            if (!input.reportValidity()) {
                event.preventDefault();
            }
        });
    });

    document.querySelectorAll("[data-period-filter]").forEach((form) => {
        const select = form.querySelector("[data-period-select]");
        const inputs = Array.from(form.querySelectorAll("[data-period-input]"));
        const syncPeriodInputs = () => {
            const mode = select?.value || "all";
            inputs.forEach((wrapper) => {
                const active = wrapper.dataset.periodInput === mode;
                wrapper.hidden = !active;
                wrapper.querySelectorAll("input, select").forEach((input) => {
                    input.disabled = !active;
                });
            });
        };

        select?.addEventListener("change", syncPeriodInputs);
        syncPeriodInputs();
    });

    document.querySelectorAll('input[type="date"], input[type="month"]').forEach((input) => {
        input.addEventListener("focus", () => {
            if (typeof input.showPicker === "function") {
                try {
                    input.showPicker();
                } catch (error) {
                    // Browser blocks showPicker in a few non-user-triggered focus cases.
                }
            }
        });
    });

    document.querySelectorAll("form").forEach((form) => {
        const start = form.querySelector("[data-range-start]");
        const end = form.querySelector("[data-range-end]");
        if (!start || !end) {
            return;
        }
        const syncRange = () => {
            if (start.value) {
                end.min = start.value;
            }
            if (start.value && end.value && end.value < start.value) {
                end.value = start.value;
            }
        };
        start.addEventListener("change", syncRange);
        end.addEventListener("change", syncRange);
        syncRange();
    });

    document.querySelectorAll("[data-copy-source]").forEach((button) => {
        button.addEventListener("click", async () => {
            const target = document.querySelector(button.dataset.copySource || "");
            const text = target?.textContent?.trim() || "";
            if (!text) {
                return;
            }
            try {
                await navigator.clipboard.writeText(text);
                const original = button.textContent;
                button.textContent = "Copied";
                setTimeout(() => {
                    button.textContent = original;
                }, 1400);
            } catch (error) {
                window.prompt("Copy this value", text);
            }
        });
    });

    const attendanceModal = document.querySelector("[data-attendance-modal]");
    const attendanceForm = attendanceModal?.querySelector("[data-attendance-form]");
    if (attendanceModal && attendanceForm) {
        const workerNode = attendanceModal.querySelector("[data-attendance-worker]");
        const dateLabelNode = attendanceModal.querySelector("[data-attendance-date-label]");
        const dateInput = attendanceModal.querySelector("[data-attendance-date]");
        const statusInput = attendanceModal.querySelector("[data-attendance-status]");
        const noteInput = attendanceModal.querySelector("[data-attendance-note]");

        const closeAttendanceModal = () => {
            attendanceModal.hidden = true;
            document.body.classList.remove("attendance-modal-open");
        };

        document.querySelectorAll("[data-attendance-open]").forEach((button) => {
            button.addEventListener("click", () => {
                attendanceForm.action = button.dataset.action || "";
                if (workerNode) {
                    workerNode.textContent = button.dataset.worker || "Worker";
                }
                if (dateLabelNode) {
                    dateLabelNode.textContent = button.dataset.dateLabel || button.dataset.date || "Selected date";
                }
                if (dateInput) {
                    dateInput.value = button.dataset.date || "";
                }
                if (statusInput) {
                    statusInput.value = button.dataset.status || "Unmarked";
                }
                if (noteInput) {
                    noteInput.value = button.dataset.note || "";
                }
                attendanceModal.hidden = false;
                document.body.classList.add("attendance-modal-open");
                noteInput?.focus();
            });
        });

        attendanceModal.querySelectorAll("[data-attendance-close]").forEach((button) => {
            button.addEventListener("click", closeAttendanceModal);
        });
        attendanceModal.querySelectorAll("[data-attendance-pick]").forEach((button) => {
            button.addEventListener("click", () => {
                if (statusInput) {
                    statusInput.value = button.dataset.attendancePick || "Unmarked";
                }
            });
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !attendanceModal.hidden) {
                closeAttendanceModal();
            }
        });
    }

    const settingsShell = document.querySelector("[data-settings-shell]");
    if (settingsShell) {
        const buttons = Array.from(settingsShell.querySelectorAll("[data-settings-tab-button]"));
        const panels = Array.from(settingsShell.querySelectorAll("[data-settings-panel]"));
        const setSettingsTab = (target) => {
            buttons.forEach((button) => {
                button.classList.toggle("active", button.dataset.settingsTabButton === target);
            });
            panels.forEach((panel) => {
                const active = panel.dataset.settingsPanel === target;
                panel.classList.toggle("active", active);
                panel.hidden = !active;
            });
            if (target) {
                window.history.replaceState(null, "", `#${target}`);
            }
        };

        buttons.forEach((button) => {
            button.addEventListener("click", () => {
                setSettingsTab(button.dataset.settingsTabButton || "shop");
            });
        });

        const initialTab = window.location.hash.replace("#", "") || "shop";
        const hasInitialTab = buttons.some((button) => button.dataset.settingsTabButton === initialTab);
        setSettingsTab(hasInitialTab ? initialTab : "shop");
    }

    const reminderRoot = document.querySelector("[data-desktop-reminders]");
    if (reminderRoot && "Notification" in window) {
        const sendReminders = () => {
            if (Notification.permission !== "granted") {
                return;
            }
            const todayKey = new Date().toISOString().slice(0, 10);
            reminderRoot.querySelectorAll("[data-reminder-id]").forEach((item) => {
                const key = `rewindin-reminder:${todayKey}:${item.dataset.reminderId}`;
                if (localStorage.getItem(key)) {
                    return;
                }
                new Notification(item.dataset.reminderTitle || "Motor reminder", {
                    body: item.dataset.reminderBody || "A motor job needs attention.",
                });
                localStorage.setItem(key, "1");
            });
        };

        if (Notification.permission === "default") {
            Notification.requestPermission().then(sendReminders);
        } else {
            sendReminders();
        }
    }

    document.querySelectorAll("[data-media-carousel]").forEach((gallery) => {
        const items = Array.from(gallery.querySelectorAll("[data-carousel-item]")).map((item) => ({
            index: Number(item.dataset.carouselIndex || 0),
            src: item.dataset.mediaSrc || "",
            type: item.dataset.mediaType || "image",
            title: item.dataset.mediaTitle || "Motor media",
        })).filter((item) => item.src);
        const main = gallery.querySelector("[data-carousel-main]");
        const previous = gallery.querySelector("[data-carousel-prev]");
        const next = gallery.querySelector("[data-carousel-next]");
        const selectors = Array.from(gallery.querySelectorAll("[data-carousel-select]"));
        let activeIndex = Number(main?.dataset.carouselIndex || 0);
        let timer = null;
        let swipeStartX = 0;
        let swipeStartY = 0;
        let swipeStarted = false;

        if (!main || items.length < 2) {
            return;
        }

        const renderCarousel = (index) => {
            activeIndex = (index + items.length) % items.length;
            const item = items[activeIndex];
            const media = item.type === "video"
                ? document.createElement("video")
                : document.createElement("img");
            media.src = item.src;
            if (item.type === "video") {
                media.muted = true;
                media.preload = "metadata";
            } else {
                media.alt = item.title;
            }

            main.dataset.carouselIndex = String(activeIndex);
            main.dataset.mediaSrc = item.src;
            main.dataset.mediaType = item.type;
            main.dataset.mediaTitle = item.title;
            main.classList.toggle("is-video", item.type === "video");
            main.replaceChildren(media);

            selectors.forEach((selector) => {
                selector.classList.toggle("active", Number(selector.dataset.carouselIndex || 0) === activeIndex);
            });
        };

        const stopCarousel = () => {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        };

        const startCarousel = () => {
            if (timer) {
                return;
            }
            timer = setInterval(() => renderCarousel(activeIndex + 1), 4000);
        };

        const chooseCarouselItem = (index) => {
            stopCarousel();
            renderCarousel(index);
            startCarousel();
        };

        previous?.addEventListener("click", () => chooseCarouselItem(activeIndex - 1));
        next?.addEventListener("click", () => chooseCarouselItem(activeIndex + 1));
        selectors.forEach((selector) => {
            selector.addEventListener("click", () => chooseCarouselItem(Number(selector.dataset.carouselIndex || 0)));
        });
        main.addEventListener("pointerdown", (event) => {
            swipeStarted = true;
            swipeStartX = event.clientX;
            swipeStartY = event.clientY;
        });
        main.addEventListener("pointerup", (event) => {
            if (!swipeStarted) {
                return;
            }
            const distanceX = event.clientX - swipeStartX;
            const distanceY = event.clientY - swipeStartY;
            swipeStarted = false;
            if (Math.abs(distanceX) > 45 && Math.abs(distanceX) > Math.abs(distanceY)) {
                event.preventDefault();
                main.dataset.carouselSwiped = "1";
                setTimeout(() => {
                    delete main.dataset.carouselSwiped;
                }, 0);
                chooseCarouselItem(activeIndex + (distanceX < 0 ? 1 : -1));
            }
        });
        main.addEventListener("pointercancel", () => {
            swipeStarted = false;
        });
        gallery.addEventListener("focusin", stopCarousel);
        gallery.addEventListener("focusout", startCarousel);

        renderCarousel(activeIndex);
        startCarousel();
    });

    const mediaTriggers = Array.from(document.querySelectorAll("[data-media-open]"));
    if (mediaTriggers.length) {
        const lightbox = document.createElement("div");
        lightbox.className = "media-lightbox";
        lightbox.hidden = true;
        lightbox.innerHTML = `
            <div class="media-lightbox-backdrop" data-media-close></div>
            <section class="media-lightbox-panel" role="dialog" aria-modal="true" aria-label="Motor media viewer">
                <div class="media-lightbox-head">
                    <strong data-media-title>Motor media</strong>
                    <button class="media-lightbox-close" type="button" data-media-close aria-label="Close media viewer">&times;</button>
                </div>
                <div class="media-lightbox-stage" data-media-stage></div>
                <div class="media-lightbox-actions">
                    <button class="button ghost small" type="button" data-media-prev>Previous</button>
                    <span data-media-counter></span>
                    <div class="media-lightbox-tools" data-media-image-tools hidden>
                        <button class="button ghost small" type="button" data-media-zoom-out>Zoom out</button>
                        <span data-media-zoom-value>100%</span>
                        <button class="button ghost small" type="button" data-media-zoom-reset>Fit</button>
                        <button class="button ghost small" type="button" data-media-zoom-in>Zoom in</button>
                    </div>
                    <button class="button ghost small" type="button" data-media-next>Next</button>
                </div>
            </section>
        `;
        document.body.appendChild(lightbox);

        const stage = lightbox.querySelector("[data-media-stage]");
        const title = lightbox.querySelector("[data-media-title]");
        const counter = lightbox.querySelector("[data-media-counter]");
        const previous = lightbox.querySelector("[data-media-prev]");
        const next = lightbox.querySelector("[data-media-next]");
        const imageTools = lightbox.querySelector("[data-media-image-tools]");
        const zoomOut = lightbox.querySelector("[data-media-zoom-out]");
        const zoomIn = lightbox.querySelector("[data-media-zoom-in]");
        const zoomReset = lightbox.querySelector("[data-media-zoom-reset]");
        const zoomValue = lightbox.querySelector("[data-media-zoom-value]");
        let activeItems = [];
        let activeIndex = 0;
        let activeMedia = null;
        let zoom = 1;
        let offsetX = 0;
        let offsetY = 0;
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let swipeStartX = 0;
        let swipeStartY = 0;
        let swipeStarted = false;

        const clampZoom = (value) => Math.min(Math.max(value, 1), 6);

        const activeItem = () => activeItems[activeIndex];

        const applyImageTransform = () => {
            if (!activeMedia || activeItem()?.type !== "image") {
                return;
            }
            if (zoom <= 1) {
                offsetX = 0;
                offsetY = 0;
            }
            activeMedia.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;
            activeMedia.style.cursor = zoom > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in";
            if (zoomValue) {
                zoomValue.textContent = `${Math.round(zoom * 100)}%`;
            }
            if (zoomOut) {
                zoomOut.disabled = zoom <= 1;
            }
            if (zoomReset) {
                zoomReset.disabled = zoom <= 1;
            }
            if (zoomIn) {
                zoomIn.disabled = zoom >= 6;
            }
        };

        const setImageZoom = (nextZoom) => {
            if (activeItem()?.type !== "image") {
                return;
            }
            zoom = clampZoom(nextZoom);
            applyImageTransform();
        };

        const resetImageView = () => {
            zoom = 1;
            offsetX = 0;
            offsetY = 0;
            applyImageTransform();
        };

        const galleryItemsFor = (trigger) => {
            const gallery = trigger.closest("[data-media-gallery]");
            const galleryItems = gallery ? Array.from(gallery.querySelectorAll("[data-carousel-item]")) : [];
            const triggers = galleryItems.length
                ? galleryItems
                : Array.from((gallery || document).querySelectorAll("[data-media-open]"));
            const seen = new Set();
            return triggers.reduce((items, item) => {
                const src = item.dataset.mediaSrc;
                const type = item.dataset.mediaType || "image";
                const key = `${type}:${src}`;
                if (!src || seen.has(key)) {
                    return items;
                }
                seen.add(key);
                items.push({
                    src,
                    type,
                    title: item.dataset.mediaTitle || "Motor media",
                });
                return items;
            }, []);
        };

        const renderMedia = () => {
            const item = activeItems[activeIndex];
            if (!item || !stage) {
                return;
            }

            activeMedia = null;
            resetImageView();
            const media = item.type === "video"
                ? document.createElement("video")
                : document.createElement("img");
            media.src = item.src;
            activeMedia = media;
            if (item.type === "video") {
                media.controls = true;
                media.autoplay = true;
                media.preload = "metadata";
            } else {
                media.alt = item.title;
                media.draggable = false;
            }

            stage.replaceChildren(media);
            stage.classList.toggle("is-zoomable", item.type === "image");
            if (imageTools) {
                imageTools.hidden = item.type !== "image";
            }
            if (title) {
                title.textContent = item.title;
            }
            if (counter) {
                counter.textContent = `${activeIndex + 1} / ${activeItems.length}`;
            }
            const singleItem = activeItems.length <= 1;
            if (previous) {
                previous.disabled = singleItem;
            }
            if (next) {
                next.disabled = singleItem;
            }
            applyImageTransform();
        };

        const closeLightbox = () => {
            lightbox.hidden = true;
            document.body.classList.remove("media-lightbox-open");
            stage?.replaceChildren();
        };

        const moveLightbox = (direction) => {
            if (!activeItems.length) {
                return;
            }
            isDragging = false;
            activeIndex = (activeIndex + direction + activeItems.length) % activeItems.length;
            renderMedia();
        };

        mediaTriggers.forEach((trigger) => {
            trigger.addEventListener("click", (event) => {
                if (trigger.dataset.carouselSwiped === "1") {
                    event.preventDefault();
                    return;
                }
                activeItems = galleryItemsFor(trigger);
                activeIndex = Math.max(0, activeItems.findIndex((item) => {
                    return item.src === trigger.dataset.mediaSrc && item.type === (trigger.dataset.mediaType || "image");
                }));
                lightbox.hidden = false;
                document.body.classList.add("media-lightbox-open");
                renderMedia();
            });
        });

        lightbox.querySelectorAll("[data-media-close]").forEach((close) => {
            close.addEventListener("click", closeLightbox);
        });
        previous?.addEventListener("click", () => moveLightbox(-1));
        next?.addEventListener("click", () => moveLightbox(1));
        zoomOut?.addEventListener("click", () => setImageZoom(zoom - 0.25));
        zoomIn?.addEventListener("click", () => setImageZoom(zoom + 0.25));
        zoomReset?.addEventListener("click", resetImageView);
        stage?.addEventListener("wheel", (event) => {
            if (lightbox.hidden || activeItem()?.type !== "image") {
                return;
            }
            event.preventDefault();
            setImageZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
        }, { passive: false });
        stage?.addEventListener("dblclick", () => {
            if (lightbox.hidden || activeItem()?.type !== "image") {
                return;
            }
            setImageZoom(zoom > 1 ? 1 : 2);
        });
        stage?.addEventListener("pointerdown", (event) => {
            if (lightbox.hidden) {
                return;
            }
            swipeStarted = true;
            swipeStartX = event.clientX;
            swipeStartY = event.clientY;
            if (activeItem()?.type !== "image" || zoom <= 1) {
                return;
            }
            isDragging = true;
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            dragOffsetX = offsetX;
            dragOffsetY = offsetY;
            stage.setPointerCapture(event.pointerId);
            applyImageTransform();
        });
        stage?.addEventListener("pointermove", (event) => {
            if (!isDragging) {
                return;
            }
            offsetX = dragOffsetX + event.clientX - dragStartX;
            offsetY = dragOffsetY + event.clientY - dragStartY;
            applyImageTransform();
        });
        const stopDragging = (event) => {
            if (!isDragging) {
                return;
            }
            isDragging = false;
            if (event.pointerId !== undefined && stage.hasPointerCapture(event.pointerId)) {
                stage.releasePointerCapture(event.pointerId);
            }
            applyImageTransform();
        };
        stage?.addEventListener("pointerup", (event) => {
            const wasDragging = isDragging;
            const distanceX = event.clientX - swipeStartX;
            const distanceY = event.clientY - swipeStartY;
            stopDragging(event);
            if (!swipeStarted) {
                return;
            }
            swipeStarted = false;
            if (!wasDragging && activeItems.length > 1 && Math.abs(distanceX) > 55 && Math.abs(distanceX) > Math.abs(distanceY)) {
                event.preventDefault();
                moveLightbox(distanceX < 0 ? 1 : -1);
            }
        });
        stage?.addEventListener("pointercancel", (event) => {
            swipeStarted = false;
            stopDragging(event);
        });
        document.addEventListener("keydown", (event) => {
            if (lightbox.hidden) {
                return;
            }
            if (event.key === "Escape") {
                closeLightbox();
            }
            if ((event.key === "+" || event.key === "=") && activeItem()?.type === "image") {
                event.preventDefault();
                setImageZoom(zoom + 0.25);
            }
            if ((event.key === "-" || event.key === "_") && activeItem()?.type === "image") {
                event.preventDefault();
                setImageZoom(zoom - 0.25);
            }
            if (event.key === "0" && activeItem()?.type === "image") {
                event.preventDefault();
                resetImageView();
            }
            if (event.key === "ArrowLeft") {
                moveLightbox(-1);
            }
            if (event.key === "ArrowRight") {
                moveLightbox(1);
            }
        });
    }

    document.querySelectorAll("[data-print]").forEach((button) => {
        button.addEventListener("click", () => window.print());
    });

    document.querySelectorAll("[data-auto-submit]").forEach((select) => {
        select.addEventListener("change", () => {
            select.className = `attendance-cell-select ${select.value.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unmarked"}`;
            select.form?.submit();
        });
    });

    const workerDirectory = document.querySelector("[data-worker-directory]");
    if (workerDirectory) {
        const searchInput = workerDirectory.querySelector("[data-worker-search]");
        const statusSelect = workerDirectory.querySelector("[data-worker-status]");
        const sortSelect = workerDirectory.querySelector("[data-worker-sort]");
        const list = workerDirectory.querySelector("[data-worker-list]");
        const empty = workerDirectory.querySelector("[data-worker-empty]");
        const rows = Array.from(workerDirectory.querySelectorAll("[data-worker-row]"));

        const numberValue = (row, key) => Number(row.dataset[key] || 0);
        const openWorkerRow = (row) => {
            const targetSelector = row.dataset.workerTarget;
            const target = targetSelector ? document.querySelector(targetSelector) : null;
            if (!target) {
                return;
            }
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            window.history.replaceState(null, "", targetSelector);
        };

        rows.forEach((row) => {
            row.addEventListener("click", (event) => {
                if (event.target.closest("a, button, input, select, textarea, label, form")) {
                    return;
                }
                openWorkerRow(row);
            });
            row.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                openWorkerRow(row);
            });
        });

        const sortRows = () => {
            const mode = sortSelect?.value || "name";
            const sortedRows = [...rows].sort((first, second) => {
                if (mode === "present") {
                    return numberValue(second, "workerPresent") - numberValue(first, "workerPresent");
                }
                if (mode === "earned") {
                    return numberValue(second, "workerEarned") - numberValue(first, "workerEarned");
                }
                if (mode === "status") {
                    return (first.dataset.workerStatus || "").localeCompare(second.dataset.workerStatus || "");
                }
                return (first.dataset.workerName || "").localeCompare(second.dataset.workerName || "");
            });
            sortedRows.forEach((row) => list?.appendChild(row));
        };

        const applyWorkerFilters = () => {
            const query = (searchInput?.value || "").trim().toLowerCase();
            const status = statusSelect?.value || "all";
            let visibleRows = 0;

            sortRows();

            rows.forEach((row) => {
                const matchesSearch = !query || (row.dataset.workerName || "").includes(query);
                const matchesStatus = status === "all" || row.dataset.workerStatus === status;
                const isVisible = matchesSearch && matchesStatus;
                row.hidden = !isVisible;
                if (isVisible) {
                    visibleRows += 1;
                }
            });

            if (empty) {
                empty.hidden = visibleRows > 0;
            }
        };

        searchInput?.addEventListener("input", applyWorkerFilters);
        statusSelect?.addEventListener("change", applyWorkerFilters);
        sortSelect?.addEventListener("change", applyWorkerFilters);
        applyWorkerFilters();
    }

    const invoiceForm = document.querySelector("[data-invoice-form]");
    if (invoiceForm) {
        const money = new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            minimumFractionDigits: 2,
        });
        const items = invoiceForm.querySelector("[data-invoice-items]");
        const addLine = invoiceForm.querySelector("[data-add-line]");
        const readNumber = (selector) => Number(invoiceForm.querySelector(selector)?.value || 0);
        const writeAmount = (selector, value) => {
            const target = invoiceForm.querySelector(selector);
            if (target) {
                target.textContent = money.format(Math.max(value, 0));
            }
        };

        const recalculate = () => {
            let subtotal = 0;
            invoiceForm.querySelectorAll("[data-invoice-row]").forEach((row) => {
                const quantity = Number(row.querySelector("[data-qty]")?.value || 0);
                const rate = Number(row.querySelector("[data-rate]")?.value || 0);
                const amount = quantity * rate;
                subtotal += amount;
                const amountNode = row.querySelector("[data-line-amount]");
                if (amountNode) {
                    amountNode.textContent = money.format(Math.max(amount, 0));
                }
            });

            const tax = subtotal * readNumber("[data-tax-rate]") / 100;
            const discount = readNumber("[data-discount]");
            const shipping = readNumber("[data-shipping]");
            const paid = readNumber("[data-paid]");
            const total = Math.max(subtotal + tax + shipping - discount, 0);
            const balance = Math.max(total - paid, 0);
            writeAmount("[data-subtotal]", subtotal);
            writeAmount("[data-total]", total);
            writeAmount("[data-balance]", balance);
        };

        const bindRow = (row) => {
            row.querySelectorAll("input").forEach((input) => {
                input.addEventListener("input", recalculate);
            });
            row.querySelector("[data-remove-line]")?.addEventListener("click", () => {
                if (invoiceForm.querySelectorAll("[data-invoice-row]").length > 1) {
                    row.remove();
                    recalculate();
                }
            });
        };

        invoiceForm.querySelectorAll("[data-invoice-row]").forEach(bindRow);
        invoiceForm.querySelectorAll("[data-tax-rate], [data-discount], [data-shipping], [data-paid]").forEach((input) => {
            input.addEventListener("input", recalculate);
        });

        addLine?.addEventListener("click", () => {
            const row = document.createElement("div");
            row.className = "invoice-item-row";
            row.setAttribute("data-invoice-row", "");
            row.innerHTML = `
                <input type="text" name="item_description[]" placeholder="Description of item/service..." required>
                <input type="number" name="item_quantity[]" value="1" min="0.01" step="0.01" data-qty required>
                <input type="number" name="item_rate[]" value="0" min="0" step="0.01" data-rate required>
                <strong data-line-amount>${money.format(0)}</strong>
                <button class="icon-button" type="button" data-remove-line aria-label="Remove line">&times;</button>
            `;
            items.appendChild(row);
            bindRow(row);
            row.querySelector("input")?.focus();
            recalculate();
        });

        recalculate();
    }
});
