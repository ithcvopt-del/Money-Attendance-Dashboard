"""แปลงไฟล์ Excel ที่ export จาก Google Sheet (แผ่นงาน "Data") เป็น data/money.sqlite

ใช้งาน:  python tools/xlsx_to_sqlite.py "สำเนาของ Data Money.xlsx"
คอลัมน์: A=Date, B=Name, C=Leave Type, D=Select Shift, E=OT, F=Picture
วันที่ในชีทเป็นปี พ.ศ. -> เก็บใน SQLite เป็น ISO ค.ศ. (yyyy-mm-dd)
"""
import sys, sqlite3, datetime, pathlib
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = (ROOT / "data" / "schema.sql").read_text(encoding="utf-8")


def to_iso(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        y, m, d = v.year, v.month, v.day
    elif isinstance(v, str) and v.strip():
        sep = "/" if "/" in v else "-"
        d, m, y = (int(p) for p in v.strip().split(sep))
    else:
        return None
    if y > 2400:  # พ.ศ. -> ค.ศ.
        y -= 543
    return f"{y:04d}-{m:02d}-{d:02d}"


def main(xlsx, out=ROOT / "data" / "money.sqlite"):
    ws = openpyxl.load_workbook(xlsx, data_only=True)["Data"]
    out = pathlib.Path(out)
    if out.exists():
        out.unlink()
    con = sqlite3.connect(out)
    con.executescript(SCHEMA)
    n = skipped = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        date, name, leave, shift, ot, pic = (list(row) + [None] * 6)[:6]
        iso = to_iso(date)
        if not iso:
            skipped += 1
            continue
        try:
            ot = float(ot) if ot not in (None, "") else 0.0
        except ValueError:
            ot = 0.0
        con.execute(
            "INSERT INTO entries(date,name,leave_type,shift,ot,picture) VALUES(?,?,?,?,?,?)",
            (iso, name or "", leave or "", shift or "", ot, pic or ""),
        )
        n += 1
    con.commit()
    con.execute("VACUUM")
    con.close()
    print(f"imported {n} rows -> {out} (skipped {skipped})")


if __name__ == "__main__":
    main(*sys.argv[1:])
