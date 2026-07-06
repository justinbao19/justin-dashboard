#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

BASE = 'https://www.formula1.com/en/results/2026'
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; F1StandingsBot/1.0)'}
REPO_DIR = Path(__file__).resolve().parents[1]
INDEX_PATH = REPO_DIR / 'index.html'
ROUND_PATTERN = re.compile(r'R(\d+)')
DATE_PATTERN = re.compile(r'20\d\d-\d\d-\d\d')

SLUG_RACE_NAME_MAP = {
    'australia': 'Australia',
    'china': 'China',
    'japan': 'Japan',
    'miami': 'Miami',
    'canada': 'Canada',
    'monaco': 'Monaco',
    'barcelona-catalunya': 'Spain',
    'austria': 'Austria',
    'great-britain': 'Great Britain',
    'belgium': 'Belgium',
    'hungary': 'Hungary',
    'netherlands': 'Netherlands',
    'italy': 'Italy',
    'spain': 'Spain',
    'azerbaijan': 'Azerbaijan',
    'singapore': 'Singapore',
    'united-states': 'United States',
    'mexico': 'Mexico',
    'brazil': 'Brazil',
    'las-vegas': 'Las Vegas',
    'qatar': 'Qatar',
    'abu-dhabi': 'Abu Dhabi',
}

TEAM_INFO = {
    'Mercedes': {'teamId': 'mercedes', 'color': '27F4D2'},
    'Ferrari': {'teamId': 'ferrari', 'color': 'E80020'},
    'McLaren': {'teamId': 'mclaren', 'color': 'FF8000'},
    'Red Bull Racing': {'teamId': 'redbullracing', 'color': '3671C6'},
    'Racing Bulls': {'teamId': 'racingbulls', 'color': '6692FF'},
    'Haas F1 Team': {'teamId': 'haasf1team', 'color': 'B6BABD'},
    'Williams': {'teamId': 'williams', 'color': '64C4FF'},
    'Audi': {'teamId': 'audi', 'color': 'FF0000'},
    'Alpine': {'teamId': 'alpine', 'color': '0093CC'},
    'Cadillac': {'teamId': 'cadillac', 'color': 'C4A35A'},
    'Aston Martin': {'teamId': 'astonmartin', 'color': '229971'},
}

NAT_MAP = {
    'Kimi Antonelli': 'ITA', 'Lewis Hamilton': 'GBR', 'George Russell': 'GBR', 'Charles Leclerc': 'MON',
    'Oscar Piastri': 'AUS', 'Lando Norris': 'GBR', 'Max Verstappen': 'NED', 'Isack Hadjar': 'FRA',
    'Pierre Gasly': 'FRA', 'Liam Lawson': 'NZL', 'Oliver Bearman': 'GBR', 'Franco Colapinto': 'ARG',
    'Arvid Lindblad': 'GBR', 'Carlos Sainz': 'ESP', 'Alexander Albon': 'THA', 'Esteban Ocon': 'FRA',
    'Gabriel Bortoleto': 'BRA', 'Fernando Alonso': 'ESP', 'Sergio Perez': 'MEX', 'Valtteri Bottas': 'FIN',
    'Lance Stroll': 'CAN', 'Nico Hulkenberg': 'GER',
}

FLAG_MAP = {
    'Australia': '🇦🇺', 'China': '🇨🇳', 'Japan': '🇯🇵', 'Austria': '🇦🇹', 'Great Britain': '🇬🇧',
    'Belgium': '🇧🇪', 'Hungary': '🇭🇺', 'Canada': '🇨🇦', 'Monaco': '🇲🇨', 'Miami': '🇺🇸',
    'Emilia-Romagna': '🇮🇹', 'Italy': '🇮🇹', 'Spain': '🇪🇸', 'Netherlands': '🇳🇱',
    'Singapore': '🇸🇬', 'Mexico': '🇲🇽', 'Brazil': '🇧🇷', 'Qatar': '🇶🇦', 'Abu Dhabi': '🇦🇪', 'Azerbaijan': '🇦🇿',
    'United States': '🇺🇸', 'Las Vegas': '🇺🇸'
}

RACE_NAME_MAP = {
    'Australia': '澳大利亚', 'China': '中国', 'Japan': '日本', 'Austria': '奥地利', 'Great Britain': '英国',
    'Belgium': '比利时', 'Hungary': '匈牙利', 'Canada': '加拿大', 'Monaco': '摩纳哥', 'Miami': '迈阿密',
    'Emilia-Romagna': '艾米利亚-罗马涅', 'Italy': '意大利', 'Spain': '西班牙', 'Netherlands': '荷兰',
    'Singapore': '新加坡', 'Mexico': '墨西哥', 'Brazil': '巴西', 'Qatar': '卡塔尔', 'Abu Dhabi': '阿布扎比', 'Azerbaijan': '阿塞拜疆',
    'United States': '美国', 'Las Vegas': '拉斯维加斯'
}


@dataclass(frozen=True)
class RaceTarget:
    round: int
    meeting: int
    slug: str
    race_name_en: str
    sprint: bool


def fetch(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.text



def race_has_results(meeting: int, slug: str) -> bool:
    try:
        rows = extract_rows(fetch(f'{BASE}/races/{meeting}/{slug}/race-result'))
    except Exception:
        return False
    if not rows:
        return False
    try:
        return bool(flatten_text(content_value(rows[0][-1])).strip())
    except Exception:
        return True


def race_has_sprint_results(meeting: int, slug: str) -> bool:
    try:
        rows = extract_rows(fetch(f'{BASE}/races/{meeting}/{slug}/sprint-results'))
    except Exception:
        return False
    return bool(rows)


def discover_latest_completed_race() -> RaceTarget:
    races_text = fetch(f'{BASE}/races')
    races: dict[int, str] = {}
    for meeting_raw, slug in re.findall(r'/en/results/2026/races/(\d+)/([^/]+)/race-result', races_text):
        meeting = int(meeting_raw)
        races.setdefault(meeting, slug)
    completed: list[tuple[int, str]] = []
    for meeting, slug in sorted(races.items()):
        if race_has_results(meeting, slug):
            completed.append((meeting, slug))
    if not completed:
        raise ValueError('no completed 2026 races found on formula1.com')
    meeting, slug = completed[-1]
    return RaceTarget(
        round=len(completed),
        meeting=meeting,
        slug=slug,
        race_name_en=SLUG_RACE_NAME_MAP.get(slug, slug.replace('-', ' ').title()),
        sprint=race_has_sprint_results(meeting, slug),
    )

def extract_rows(text: str) -> list[list[dict[str, Any]]]:
    patterns = [
        r'rows\\":(\[\[.*?\]\]),\\"expandable\\":',
        r'rows":(\[\[.*?\]\]),"expandable":',
    ]
    raw = None
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            raw = m.group(1)
            break
    if raw is None:
        raise ValueError('rows block not found')
    raw = raw.encode('utf-8').decode('unicode_escape')
    return json.loads(raw)


def content_value(cell: Any) -> Any:
    if isinstance(cell, dict) and 'content' in cell:
        return cell['content']
    return cell


def flatten_text(node: Any) -> str:
    if node is None:
        return ''
    if isinstance(node, str):
        if node in ('$undefined',):
            return ''
        return node.replace('Â', ' ')
    if isinstance(node, (int, float)):
        return str(node)
    if isinstance(node, list):
        if node and node[0] == '$':
            if len(node) >= 4 and isinstance(node[3], dict):
                return flatten_text(node[3].get('children'))
            return ''
        parts = [flatten_text(x) for x in node]
        return ''.join(parts)
    if isinstance(node, dict):
        return flatten_text(node.get('children'))
    return ''


def parse_driver_standings() -> list[dict[str, Any]]:
    rows = extract_rows(fetch(f'{BASE}/drivers'))
    out = []
    for row in rows:
        pos = int(flatten_text(content_value(row[0])).strip())
        driver_node = content_value(row[1])
        href = ''
        if isinstance(driver_node, list) and len(driver_node) >= 4 and isinstance(driver_node[3], dict):
            href = driver_node[3].get('href', '')
        code = href.split('/drivers/')[-1].split('/')[0].lower()
        children = driver_node[3].get('children', []) if isinstance(driver_node, list) and len(driver_node) >= 4 and isinstance(driver_node[3], dict) else []
        visible_parts = []
        if isinstance(children, list) and len(children) >= 2:
            text_node = children[1]
            nested = text_node[3].get('children', []) if isinstance(text_node, list) and len(text_node) >= 4 and isinstance(text_node[3], dict) else []
            for part in nested:
                text_part = flatten_text(part).strip()
                if text_part and text_part not in {'ANT', 'RUS', 'HAM', 'PIA', 'NOR', 'LEC', 'VER', 'HAD', 'GAS', 'LAW', 'BEA', 'COL', 'LIN', 'SAI', 'ALB', 'OCO', 'BOR', 'ALO', 'PER', 'BOT', 'STR', 'HUL'}:
                    visible_parts.append(text_part)
        name = ' '.join(' '.join(visible_parts).replace('\xa0', ' ').split())
        nat = flatten_text(content_value(row[2])).strip()
        team = ' '.join(flatten_text(content_value(row[3])).split())
        points = int(flatten_text(content_value(row[4])).strip())
        team_meta = TEAM_INFO[team]
        out.append({
            'pos': pos,
            'name': name,
            'team': team,
            'teamId': team_meta['teamId'],
            'driverCode': code,
            'color': team_meta['color'],
            'points': points,
            'nat': nat or NAT_MAP.get(name, 'UNK'),
        })
    return out


def parse_team_standings() -> list[dict[str, Any]]:
    rows = extract_rows(fetch(f'{BASE}/team'))
    out = []
    for row in rows:
        pos = int(flatten_text(content_value(row[0])).strip())
        team = ' '.join(flatten_text(content_value(row[1])).split())
        points = int(flatten_text(content_value(row[2])).strip())
        out.append({'pos': pos, 'name': team, 'color': TEAM_INFO[team]['color'], 'points': points})
    return out


def parse_meeting_meta(races_text: str, slug: str) -> tuple[int, str]:
    patt = re.compile(rf'"path":"/en/results/2026/races/(?P<meeting>\d+)/{re.escape(slug)}/race-result"')
    m = patt.search(races_text)
    if not m:
        raise ValueError(f'meeting slug not found: {slug}')
    meeting = int(m.group('meeting'))
    title_match = re.search(rf'"path":"/en/results/2026/races/{meeting}/{re.escape(slug)}/race-result".*?"text":"FORMULA 1 .*? GRAND PRIX 2026"', races_text)
    return meeting, slug


def parse_round_from_index(text: str) -> int:
    m = ROUND_PATTERN.search(text)
    if not m:
        raise ValueError('round not found in index comments')
    return int(m.group(1))


def parse_session_map(round_number: int, meeting: int, meeting_slug: str, sprint_expected: bool) -> tuple[dict[str, Any], dict[str, Any] | None, dict[str, Any] | None]:
    base = f'{BASE}/races/{meeting}/{meeting_slug}'
    race_url = base + '/race-result'
    qual_url = base + '/qualifying'
    sprint_url = base + '/sprint-results'
    race_rows = extract_rows(fetch(race_url))
    qual_rows = extract_rows(fetch(qual_url))
    try:
        sprint_rows = extract_rows(fetch(sprint_url))
    except Exception:
        sprint_rows = []
    race = {}
    for row in race_rows:
        code = flatten_text(content_value(row[2])).split()[-1]
        # fallback to image path
        node = content_value(row[2])
        blob = json.dumps(node, ensure_ascii=False)
        m = re.search(r'/([a-z0-9]{8})/2026', blob)
        if m:
            code = m.group(1)
        else:
            href = re.search(r'/common/f1/2026/[^/]+/([a-z0-9]{8})/', blob)
            code = href.group(1) if href else code.lower()
        race[code.lower()] = {
            'result': normalize_position(flatten_text(content_value(row[0])).strip()),
            'points': int(flatten_text(content_value(row[-1])).strip()),
        }
    qual = {}
    for row in qual_rows:
        node = content_value(row[2])
        blob = json.dumps(node, ensure_ascii=False)
        href = re.search(r'/common/f1/2026/[^/]+/([a-z0-9]{8})/', blob)
        if not href:
            continue
        qual[href.group(1).lower()] = normalize_position(flatten_text(content_value(row[0])).strip())
    sprint = None
    if sprint_rows:
        sprint = {}
        for row in sprint_rows:
            node = content_value(row[2])
            blob = json.dumps(node, ensure_ascii=False)
            href = re.search(r'/common/f1/2026/[^/]+/([a-z0-9]{8})/', blob)
            if not href:
                continue
            sprint[href.group(1).lower()] = normalize_position(flatten_text(content_value(row[0])).strip())
    elif sprint_expected:
        sprint = {}
    return race, qual, sprint


def normalize_position(value: str) -> Any:
    value = value.strip()
    if value.isdigit():
        return int(value)
    return value or None


def js_value(value: Any) -> str:
    if value is None:
        return 'null'
    if isinstance(value, str):
        escaped = value.replace('\\', '\\\\').replace("'", "\\'")
        return f"'{escaped}'"
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return str(value)


def format_js_object(obj: dict[str, Any], indent: int = 12) -> str:
    pad = ' ' * indent
    inner = ', '.join(f"{k}: {js_value(v)}" for k, v in obj.items())
    return pad + '{ ' + inner + ' }'


def format_driver_standings(data: list[dict[str, Any]]) -> str:
    lines = ['const DRIVER_STANDINGS = [']
    for item in data:
        lines.append(format_js_object(item) + ',')
    lines.append('        ];')
    return '\n'.join(lines)


def format_team_standings(data: list[dict[str, Any]]) -> str:
    lines = ['const TEAM_STANDINGS = [']
    for item in data:
        lines.append(format_js_object(item) + ',')
    lines.append('        ];')
    return '\n'.join(lines)


def format_race_results(data: dict[str, list[dict[str, Any]]]) -> str:
    lines = ['const RACE_RESULTS_2026 = {']
    items = list(data.items())
    for idx, (code, entries) in enumerate(items):
        lines.append(f"            '{code}': [")
        for entry in entries:
            lines.append(format_js_object(entry, indent=16) + ',')
        suffix = ',' if idx < len(items) - 1 else ''
        lines.append(f'            ]{suffix}')
    lines.append('        };')
    return '\n'.join(lines)


def replace_const_block(text: str, const_name: str, replacement: str) -> str:
    marker = f'const {const_name} = '
    start = text.find(marker)
    if start == -1:
        raise ValueError(f'{const_name} not found')
    brace_start = text.find('{' if const_name == 'RACE_RESULTS_2026' else '[', start)
    opener = text[brace_start]
    closer = '}' if opener == '{' else ']'
    depth = 0
    in_string = False
    quote = ''
    escape = False
    end = None
    for i in range(brace_start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == quote:
                in_string = False
        else:
            if ch in ('\"', "'"):
                in_string = True
                quote = ch
            elif ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    semi = text.find(';', i)
                    end = semi + 1
                    break
    if end is None:
        raise ValueError(f'could not find end of {const_name}')
    return text[:start] + replacement + text[end:]


def update_comment(text: str, prefix: str, round_num: int, race_name_cn: str, date_str: str) -> str:
    pattern = re.compile(rf'// {re.escape(prefix)} \(.*?\) - \d{{4}}-\d{{2}}-\d{{2}} 更新')
    repl = f'// {prefix} ({race_name_cn}站后 R{round_num}) - {date_str} 更新'
    return pattern.sub(repl, text, count=1)


def parse_existing_race_results(existing_text: str) -> dict[str, list[dict[str, Any]]]:
    block = re.search(r"const RACE_RESULTS_2026 = \{(.*?)\n        \};", existing_text, re.S)
    if not block:
        raise ValueError('existing RACE_RESULTS_2026 not found')
    body = block.group(1)
    result = {}
    for key, arr in re.findall(r"'([^']+)': \[(.*?)\n            \]", body, re.S):
        items = []
        for obj in re.findall(r"\{(.*?)\}", arr, re.S):
            parts = [p.strip() for p in obj.split(',') if p.strip()]
            item = {}
            for part in parts:
                k, v = part.split(':', 1)
                k = k.strip()
                v = v.strip()
                if v == 'null':
                    val = None
                elif v.startswith("'") and v.endswith("'"):
                    val = v[1:-1]
                elif re.fullmatch(r'-?\d+', v):
                    val = int(v)
                else:
                    val = v
                item[k] = val
            items.append(item)
        result[key] = items
    return result


def build_updated_race_results(existing_text: str, round_num: int, meeting: int, meeting_slug: str, race_name_en: str, sprint_expected: bool) -> dict[str, list[dict[str, Any]]]:
    existing = parse_existing_race_results(existing_text)
    race_map, qual_map, sprint_map = parse_session_map(round_num, meeting, meeting_slug, sprint_expected)
    race_name_cn = RACE_NAME_MAP.get(race_name_en, race_name_en)
    flag = FLAG_MAP.get(race_name_en, '🏁')
    for code, results in existing.items():
        if code not in race_map:
            continue
        results = [r for r in results if r.get('round') != round_num]
        entry = {
            'round': round_num,
            'race': race_name_cn,
            'flag': flag,
            'qual': qual_map.get(code),
            'sprint': sprint_map.get(code) if sprint_map is not None and sprint_map else (None if not sprint_expected else sprint_map.get(code)),
            'result': race_map[code]['result'],
            'points': race_map[code]['points'],
        }
        results.append(entry)
        results.sort(key=lambda x: x['round'])
        existing[code] = results
    return existing


def git_has_changes() -> bool:
    r = subprocess.run(['git', '-C', str(REPO_DIR), 'status', '--short'], capture_output=True, text=True, check=True)
    return bool(r.stdout.strip())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--push', action='store_true')
    parser.add_argument('--no-commit', action='store_true')
    parser.add_argument('--meeting-id', type=int)
    parser.add_argument('--meeting-slug')
    parser.add_argument('--race-name-en')
    parser.add_argument('--round', type=int)
    parser.add_argument('--sprint', action='store_true')
    args = parser.parse_args()

    if args.meeting_id and args.meeting_slug and args.race_name_en and args.round:
        target = RaceTarget(args.round, args.meeting_id, args.meeting_slug, args.race_name_en, args.sprint)
    elif not any((args.meeting_id, args.meeting_slug, args.race_name_en, args.round, args.sprint)):
        target = discover_latest_completed_race()
    else:
        parser.error('manual mode requires --meeting-id, --meeting-slug, --race-name-en, and --round')

    print(f'Updating F1 standings for {target.race_name_en} GP (R{target.round}, meeting {target.meeting}/{target.slug}, sprint={target.sprint})')

    text = INDEX_PATH.read_text()
    date_str = datetime.now().strftime('%Y-%m-%d')
    driver_standings = parse_driver_standings()
    team_standings = parse_team_standings()
    race_results = build_updated_race_results(text, target.round, target.meeting, target.slug, target.race_name_en, target.sprint)

    text = replace_const_block(text, 'RACE_RESULTS_2026', format_race_results(race_results))
    text = replace_const_block(text, 'DRIVER_STANDINGS', format_driver_standings(driver_standings))
    text = replace_const_block(text, 'TEAM_STANDINGS', format_team_standings(team_standings))
    race_name_cn = RACE_NAME_MAP.get(target.race_name_en, target.race_name_en)
    text = update_comment(text, '2026 分站成绩', target.round, race_name_cn, date_str)
    text = update_comment(text, '2026 积分榜', target.round, race_name_cn, date_str)
    text = update_comment(text, '车队积分榜', target.round, race_name_cn, date_str)

    if args.dry_run:
        tmp = INDEX_PATH.with_suffix('.index.tmp')
        tmp.write_text(text)
        print(f'dry-run wrote {tmp}')
        return 0

    INDEX_PATH.write_text(text)
    if args.no_commit:
        print('updated index.html without committing')
        return 0
    subprocess.run(['git', '-C', str(REPO_DIR), 'add', 'index.html'], check=True)
    msg = f'Update F1 standings after {target.race_name_en} GP (R{target.round})'
    commit = subprocess.run(['git', '-C', str(REPO_DIR), 'commit', '-m', msg], capture_output=True, text=True)
    if commit.returncode != 0:
        if 'nothing to commit' not in commit.stdout.lower() and 'nothing to commit' not in commit.stderr.lower():
            sys.stderr.write(commit.stdout + commit.stderr)
            return commit.returncode
    else:
        print(commit.stdout)
    if args.push:
        subprocess.run(['git', '-C', str(REPO_DIR), 'push'], check=True)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

