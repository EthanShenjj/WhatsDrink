"""Subset and embed the CJK font used by the generated WhatsDrink DOCX.

The source macOS font has installable embedding permissions (OS/2 fsType 0).
Only glyphs that occur in the document are embedded.
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from fontTools import subset
from fontTools.ttLib import TTFont


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
FONT_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"
)
FONT_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.obfuscatedFont"

ET.register_namespace("w", W_NS)
ET.register_namespace("r", R_NS)
ET.register_namespace("", REL_NS)


def collect_text(docx_path: Path) -> str:
    chars: list[str] = []
    with zipfile.ZipFile(docx_path) as archive:
        for name in archive.namelist():
            if not name.startswith("word/") or not name.endswith(".xml"):
                continue
            try:
                root = ET.fromstring(archive.read(name))
            except ET.ParseError:
                continue
            for node in root.iter():
                if node.text:
                    chars.append(node.text)
    # Keep common punctuation and digits available for fields and fallback rendering.
    chars.append(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
        "0123456789 ，。、“”‘’：；！？—…·（）()[]+-/%℃¥"
    )
    return "".join(chars)


def subset_font(source: Path, font_number: int, text: str, output: Path) -> None:
    font = TTFont(str(source), fontNumber=font_number)
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recalc_average_width = True
    options.recalc_max_context = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    font.save(str(output))
    font.close()


def obfuscate_font(font_path: Path, key: uuid.UUID) -> bytes:
    data = bytearray(font_path.read_bytes())
    # ECMA-376 §17.8.1: reverse the bytes of the canonical big-endian GUID.
    key_bytes = key.bytes[::-1]
    for index in range(min(32, len(data))):
        data[index] ^= key_bytes[index % 16]
    return bytes(data)


def add_embedded_font(
    unpacked: Path,
    font_name: str,
    regular_path: Path,
    bold_path: Path,
) -> None:
    font_table_path = unpacked / "word" / "fontTable.xml"
    font_table = ET.parse(font_table_path)
    font_root = font_table.getroot()

    font_node = None
    for candidate in font_root.findall(f"{{{W_NS}}}font"):
        if candidate.get(f"{{{W_NS}}}name") == font_name:
            font_node = candidate
            break
    if font_node is None:
        font_node = ET.SubElement(
            font_root, f"{{{W_NS}}}font", {f"{{{W_NS}}}name": font_name}
        )
        ET.SubElement(
            font_node, f"{{{W_NS}}}family", {f"{{{W_NS}}}val": "swiss"}
        )
        ET.SubElement(
            font_node, f"{{{W_NS}}}charset", {f"{{{W_NS}}}val": "86"}
        )
        ET.SubElement(
            font_node, f"{{{W_NS}}}pitch", {f"{{{W_NS}}}val": "variable"}
        )

    for tag in ("embedRegular", "embedBold", "embedItalic", "embedBoldItalic"):
        for node in font_node.findall(f"{{{W_NS}}}{tag}"):
            font_node.remove(node)

    fonts_dir = unpacked / "word" / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)

    rels_dir = unpacked / "word" / "_rels"
    rels_dir.mkdir(parents=True, exist_ok=True)
    rels_path = rels_dir / "fontTable.xml.rels"
    if rels_path.exists():
        rels_tree = ET.parse(rels_path)
        rels_root = rels_tree.getroot()
    else:
        rels_root = ET.Element(f"{{{REL_NS}}}Relationships")
        rels_tree = ET.ElementTree(rels_root)

    for rel in list(rels_root):
        if rel.get("Type") == FONT_REL_TYPE:
            target = rel.get("Target", "")
            if target.startswith("fonts/"):
                embedded = unpacked / "word" / target
                if embedded.exists():
                    embedded.unlink()
            rels_root.remove(rel)

    variants = (
        ("embedRegular", "rIdEmbeddedRegular", "WhatsDrink-Regular.odttf", regular_path),
        ("embedBold", "rIdEmbeddedBold", "WhatsDrink-Bold.odttf", bold_path),
    )
    for tag, rel_id, file_name, font_path in variants:
        key = uuid.uuid4()
        (fonts_dir / file_name).write_bytes(obfuscate_font(font_path, key))
        ET.SubElement(
            rels_root,
            f"{{{REL_NS}}}Relationship",
            {
                "Id": rel_id,
                "Type": FONT_REL_TYPE,
                "Target": f"fonts/{file_name}",
            },
        )
        ET.SubElement(
            font_node,
            f"{{{W_NS}}}{tag}",
            {
                f"{{{R_NS}}}id": rel_id,
                f"{{{W_NS}}}fontKey": "{" + str(key).upper() + "}",
                f"{{{W_NS}}}subsetted": "true",
            },
        )

    font_table.write(font_table_path, encoding="UTF-8", xml_declaration=True)
    rels_tree.write(rels_path, encoding="UTF-8", xml_declaration=True)

    content_types_path = unpacked / "[Content_Types].xml"
    content_types = ET.parse(content_types_path)
    content_root = content_types.getroot()
    has_odttf = any(
        node.tag == f"{{{CT_NS}}}Default"
        and node.get("Extension") == "odttf"
        for node in content_root
    )
    if not has_odttf:
        ET.SubElement(
            content_root,
            f"{{{CT_NS}}}Default",
            {"Extension": "odttf", "ContentType": FONT_CONTENT_TYPE},
        )
    ET.register_namespace("", CT_NS)
    content_types.write(content_types_path, encoding="UTF-8", xml_declaration=True)


def embed(docx_path: Path, light_source: Path, medium_source: Path) -> None:
    text = collect_text(docx_path)
    with tempfile.TemporaryDirectory(prefix="whatsdrink-font-") as temp_name:
        temp = Path(temp_name)
        regular_subset = temp / "regular.ttf"
        bold_subset = temp / "bold.ttf"
        subset_font(light_source, 1, text, regular_subset)
        subset_font(medium_source, 1, text, bold_subset)

        unpacked = temp / "docx"
        with zipfile.ZipFile(docx_path) as archive:
            archive.extractall(unpacked)
        add_embedded_font(unpacked, "Heiti SC", regular_subset, bold_subset)

        staged = temp / docx_path.name
        with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(unpacked.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(unpacked).as_posix())
        shutil.copy2(staged, docx_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx", type=Path)
    parser.add_argument(
        "--light",
        type=Path,
        default=Path("/System/Library/Fonts/STHeiti Light.ttc"),
    )
    parser.add_argument(
        "--medium",
        type=Path,
        default=Path("/System/Library/Fonts/STHeiti Medium.ttc"),
    )
    args = parser.parse_args()
    embed(args.docx.resolve(), args.light.resolve(), args.medium.resolve())
    print(args.docx.resolve())


if __name__ == "__main__":
    main()
