"""A Sky For Two - Streamlit shell.

Streamlit hosts the page; the sky itself is a web app that runs in the visitor's browser (canvas renderer, astronomy maths and
star data), shipped as one file: sky.html. To change texts, edit frontend/config.json and run
`node tools/bundle.mjs` to rebuild sky.html.

Run locally:   streamlit run app.py
Deploy:        push this folder to GitHub, then create the app on share.streamlit.io (main file: app.py)
"""
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="A Sky For Two",
    page_icon="\U0001F30C",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Remove every bit of Streamlit chrome so the sky is the whole page.
CSS = """<style>
html, body, [data-testid="stApp"], [data-testid="stAppViewContainer"] { background: #05060A !important; }
[data-testid="stHeader"], [data-testid="stToolbar"], [data-testid="stDecoration"],
[data-testid="stStatusWidget"], [data-testid="stSidebar"], [data-testid="collapsedControl"],
#MainMenu, footer, .stDeployButton { display: none !important; visibility: hidden !important; }
.block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: 100% !important; }
[data-testid="stVerticalBlock"] { gap: 0 !important; }
iframe { border: 0 !important; display: block; width: 100% !important; height: 100vh !important; min-height: 100vh !important; }
@supports (height: 100dvh) { iframe { height: 100dvh !important; min-height: 100dvh !important; } }
body { overflow: hidden; }
</style>"""

# (no leading spaces on any line: indented text would be rendered as a code block)
st.markdown(CSS, unsafe_allow_html=True)

SKY = Path(__file__).parent / "sky.html"
if not SKY.exists():
    st.error("sky.html is missing from the repository. Upload every file from the zip, including sky.html and the static folder.")
    st.stop()

# The whole sky (code, styles and star data) is one self-contained HTML file, so it is rendered straight
# into the page - nothing else has to be served, which is what makes it reliable on Streamlit Cloud.
components.html(SKY.read_text(encoding="utf-8"), height=800, scrolling=False)
