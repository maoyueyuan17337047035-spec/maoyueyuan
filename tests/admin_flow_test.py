import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://127.0.0.1:4174"
API_URL = "https://portfolio-admin.example.test"


def wire_mock_cloud(page, state):
    page.route(
        f"{API_URL}/session",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"token": "test-session", "expiresIn": 7200}),
        ),
    )

    def ticket(route):
        state["ticket"] = route.request.post_data_json
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "uploadId": "test-upload",
                    "expiresIn": 900,
                    "uploads": [
                        {
                            "kind": "video",
                            "key": "portfolio/works/overseas/2026-08-25/test-video.mp4",
                            "url": "https://upload.example.test/video",
                            "publicUrl": "https://cdn.example.test/test-video.mp4",
                            "headers": {"Content-Type": "video/mp4"},
                        },
                        {
                            "kind": "poster",
                            "key": "portfolio/works/overseas/2026-08-25/test-poster.jpg",
                            "url": "https://upload.example.test/poster",
                            "publicUrl": "https://cdn.example.test/test-poster.jpg",
                            "headers": {"Content-Type": "image/jpeg"},
                        },
                    ],
                }
            ),
        )

    page.route(f"{API_URL}/upload-ticket", ticket)

    def publish(route):
        body = route.request.post_data_json
        state["publish"] = body
        route.fulfill(
            status=201,
            content_type="application/json",
            body=json.dumps({"work": {**body, "id": "test-work"}}),
        )

    page.route(f"{API_URL}/works", publish)

    def receive_upload(route):
        state["uploads"].append(route.request.url)
        route.fulfill(status=200, headers={"ETag": '"test-etag"'}, body="")

    page.route("https://upload.example.test/**", receive_upload)


def main():
    state = {"uploads": [], "ticket": None, "publish": None}
    issues = []
    screenshots = ROOT / "tests" / "artifacts"
    screenshots.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda message: issues.append(f"console:{message.type}:{message.text}") if message.type == "error" else None)
        page.on("pageerror", lambda error: issues.append(f"pageerror:{error}"))
        wire_mock_cloud(page, state)

        page.goto(f"{BASE_URL}/admin.html?api={API_URL}")
        page.wait_for_load_state("networkidle")
        page.locator("#admin-password").fill("test-password-strong")
        page.get_by_role("button", name="进入工作台").click()
        page.locator("[data-admin-workspace]").wait_for(state="visible")
        page.locator("input[name='title']").fill("测试海外漫剧")
        page.locator("input[name='video']").set_input_files(str(ROOT / "assets/video/mozun-fanpai.mp4"))
        page.locator("input[name='poster']").set_input_files(str(ROOT / "assets/images/mozun-fanpai-poster.jpg"))
        page.locator("[data-video-meta]").filter(has_text="×").wait_for()
        page.get_by_role("button", name="上传并发布").click()
        page.locator("[data-publish-result]").wait_for(state="visible")
        page.screenshot(path=str(screenshots / "admin-desktop.png"), full_page=True)

        assert page.locator("[data-progress-value]").inner_text() == "100%"
        assert "测试海外漫剧" in page.locator("[data-result-title]").inner_text()
        assert state["ticket"]["category"] == "overseas"
        assert state["publish"]["category"] == "overseas"
        assert len(state["uploads"]) == 2
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

        page.get_by_role("button", name="继续上传下一部").click()
        page.locator("input[name='title']").fill("自动封面测试")
        page.locator("input[name='video']").set_input_files(str(ROOT / "assets/video/mozun-fanpai.mp4"))
        page.locator("[data-video-meta]").filter(has_text="×").wait_for()
        page.get_by_role("button", name="上传并发布").click()
        page.locator("[data-publish-result]").wait_for(state="visible")
        assert page.locator("[data-poster-name]").inner_text() == "已从视频自动生成封面"
        assert len(state["uploads"]) == 4

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        wire_mock_cloud(mobile, {"uploads": [], "ticket": None, "publish": None})
        mobile.goto(f"{BASE_URL}/admin.html?api={API_URL}")
        mobile.wait_for_load_state("networkidle")
        mobile.screenshot(path=str(screenshots / "admin-mobile.png"), full_page=True)
        assert mobile.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

        public_page = browser.new_page(viewport={"width": 1440, "height": 1000})
        public_page.on("pageerror", lambda error: issues.append(f"public-pageerror:{error}"))
        public_page.route(
            "**/portfolio/catalog/works.json*",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(
                    {
                        "version": 1,
                        "works": [
                            {
                                "id": "remote-test",
                                "category": "overseas",
                                "title": "云端新增作品",
                                "englishTitle": "REMOTE WORK",
                                "video": f"{BASE_URL}/assets/video/mozun-fanpai.mp4",
                                "poster": f"{BASE_URL}/assets/images/mozun-fanpai-poster.jpg",
                                "duration": "15.1s",
                                "format": "横屏",
                                "role": "公司项目 · 参与制作",
                                "summary": "用于验证云端作品目录自动渲染。",
                                "published": True,
                            }
                        ],
                    }
                ),
            ),
        )
        public_page.goto(f"{BASE_URL}/#/home")
        public_page.wait_for_load_state("networkidle")
        public_page.locator("[data-home-overseas-grid] article").nth(3).wait_for()
        assert public_page.locator("[data-home-overseas-grid] article").count() == 4
        public_page.locator("[data-home-overseas-grid] article").nth(3).locator("[data-play-film]").click()
        public_page.locator("[data-film-modal]").wait_for(state="visible")
        assert public_page.locator("[data-film-title]").inner_text() == "云端新增作品"
        assert public_page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

        browser.close()

    print(json.dumps({"ok": not issues, "issues": issues, "uploads": state["uploads"]}, ensure_ascii=False))
    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
