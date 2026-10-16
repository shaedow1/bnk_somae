import json
import pathlib
import re

import pymupdf


def exam_num(path):
    return int(re.search(r"[0-9]+", path.name).group(0))


def clean_text(value):
    value = value.split("\n▣", 1)[0]
    value = re.sub(r"(?m)^\s*(?:수신\s+[0-9]+(?:-[0-9]+|\s*/\s*[0-9]+)|Ⅳ\.?\s*다음 문제를 읽고 알맞은 답을 쓰시오.*|-?\s*수고하셨습니다\s*-?).*$", "", value)
    value = re.sub(r"수신\s*[0-9]+권\s*P\.?\s*[0-9~.,\-]+", "", value, flags=re.I)
    value = re.sub(r"\n\s*\n+", "\n", value)
    return value.strip()


records = []
for path in sorted(pathlib.Path("docs").glob("*.pdf"), key=exam_num):
    exam = exam_num(path)
    text = "\n".join(page.get_text() for page in pymupdf.open(path))
    text = re.sub(r"수신\s+[0-9]+-[0-9]+\s*", "\n", text)
    starts = list(re.finditer(r"^\s*([0-9]{1,2})\.\s+", text, re.M))
    for index, match in enumerate(starts):
        number = int(match.group(1))
        block = text[match.start(): starts[index + 1].start() if index + 1 < len(starts) else len(text)]
        body = re.sub(r"^\s*[0-9]{1,2}\.\s*", "", block.strip(), count=1)
        marker = re.search(r"(?:☞|정답\s*[:：.]?)\s*", body)
        before = body[:marker.start()].strip() if marker else body.strip()
        after = body[marker.end():].strip() if marker else ""
        kind = "ox" if number <= 10 else "mc" if number <= 30 else "fill" if number <= 40 else "essay"
        options, answer, explanation, reference = [], "", "", ""
        ref_match = re.search(r"(?:수신\s*)?(?:[0-9]\s*권\s*[,/]?\s*)?P\.?\s*[0-9][0-9~.,\-]*", after, re.I)
        if ref_match:
            reference = ref_match.group(0).strip(" ,，")
            answer_text = (after[:ref_match.start()] + " " + after[ref_match.end():]).strip(" ,， ")
        else:
            answer_text = after

        if kind == "ox":
            question = re.split(r"-{2,}\s*\(\s*\)", before)[0].strip()
            answer_match = re.search(r"(?:\(\s*([oOxX])\s*\)|\b([oOxX])\b|([⒪⒳])|\b([01])\b)", answer_text)
            answer = next((part.upper() for part in answer_match.groups() if part), "") if answer_match else ""
            answer = {"⒪": "O", "⒳": "X", "0": "O", "1": "X"}.get(answer, answer)
            explanation = re.sub(r"(?:\(\s*[oOxX]\s*\)|\b[oOxX]\b|[⒪⒳]|\b[01]\b)", "", answer_text).strip(" ,，()")
        elif kind == "mc":
            question = re.split(r"(?=①)", before)[0].strip()
            question = re.sub(r"-{4,}\s*\(\s*\)\s*", "", question).strip()
            options = [item.strip() for item in re.findall(r"[①②③④]\s*(.*?)(?=\s*[①②③④]|$)", before, re.S)]
            answer_match = re.search(r"[①②③④]", answer_text)
            if answer_match:
                answer = "①②③④".index(answer_match.group(0))
            else:
                numeric_answer = re.search(r"\b([1-4])\b", answer_text)
                answer = int(numeric_answer.group(1)) - 1 if numeric_answer else None
            explanation = answer_text.replace(answer_match.group(0), "", 1).strip(" ,，()") if answer_match else answer_text
        elif kind == "fill":
            question, answer = before, clean_text(answer_text.strip("(){} "))
            if exam == 114 and number == 40:
                question = "다음은 사적연금소득에 대한 과세 체계로 빈칸 ①, ②를 채우시오."
                answer = "① 연금소득 ② 1,500만원"
        else:
            question_lines, answer_lines, in_answer = [], [], False
            for line in before.splitlines():
                stripped = line.strip()
                blank_slot = bool(re.match(r"^[①②③④]\s{5,}", line))
                starts_list = re.match(r"^(?:[-•]|[①②③④])\s*\S", stripped)
                if not in_answer and starts_list and not blank_slot:
                    in_answer = True
                (answer_lines if in_answer else question_lines).append(stripped)
            question = clean_text("\n".join(line for line in question_lines if line))
            inline_answer = clean_text("\n".join(line for line in answer_lines if line))
            answer_after_key = clean_text(answer_text.strip("(){} "))
            answer = answer_after_key or inline_answer

        question = clean_text(re.sub(r"[ \t]+\n", "\n", question))
        answer = clean_text(answer) if isinstance(answer, str) else answer
        explanation = clean_text(explanation)
        options = [re.sub(r"\s+", " ", item).strip() for item in options]
        records.append({"exam": exam, "n": number, "type": kind, "q": question,
                        "o": options, "a": answer, "e": explanation, "r": reference})

pathlib.Path("suntae/questions.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
print("records", len(records), "types", {kind: sum(row["type"] == kind for row in records) for kind in ("ox", "mc", "fill", "essay")})
for row in records:
    if not row["q"] or row["a"] in ("", None) or (row["type"] == "mc" and len(row["o"]) != 4):
        print("CHECK", row["exam"], row["n"], repr(row["q"][:70]), len(row["o"]), repr(str(row["a"])[:70]))
