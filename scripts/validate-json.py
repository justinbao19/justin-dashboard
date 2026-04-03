#!/usr/bin/env python3
"""
JSON 验证和自动修复脚本
用法: python3 validate-json.py <json_file>

功能:
1. 验证 JSON 语法
2. 自动修复中文引号问题
3. 格式化输出

在任何 JSON 写入操作后调用此脚本确保数据有效
"""

import json
import sys
import re
from pathlib import Path


def fix_chinese_quotes(content: str) -> str:
    """替换中文引号为不干扰 JSON 的字符"""
    # 仅替换中文/智能引号，避免破坏 JSON 结构本身的 ASCII 双引号
    content = content.replace("“", "「").replace("”", "」")
    content = content.replace("‘", "『").replace("’", "』")
    return content


def validate_and_fix(file_path: str) -> bool:
    """验证 JSON 并尝试自动修复"""
    path = Path(file_path)
    
    if not path.exists():
        print(f"❌ 文件不存在: {file_path}")
        return False
    
    content = path.read_text(encoding='utf-8')
    original = content
    
    # 第一次尝试解析
    try:
        data = json.loads(content)
        print(f"✅ {path.name} - JSON 有效")
        return True
    except json.JSONDecodeError as e:
        print(f"⚠️  {path.name} - 发现问题，尝试自动修复...")
        print(f"   原始错误: 第 {e.lineno} 行, 第 {e.colno} 列 - {e.msg}")
    
    # 尝试修复
    content = fix_chinese_quotes(content)
    
    try:
        data = json.loads(content)
        
        # 写回修复后的内容（格式化）
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding='utf-8'
        )
        print(f"✅ {path.name} - 已自动修复并格式化")
        return True
        
    except json.JSONDecodeError as e:
        print(f"❌ {path.name} - 自动修复失败")
        print(f"   错误: 第 {e.lineno} 行, 第 {e.colno} 列 - {e.msg}")
        
        # 显示问题行上下文
        lines = content.split('\n')
        start = max(0, e.lineno - 3)
        end = min(len(lines), e.lineno + 2)
        
        print("\n   上下文:")
        for i in range(start, end):
            marker = ">>>" if i == e.lineno - 1 else "   "
            print(f"   {marker} {i+1}: {lines[i][:80]}")
        
        return False


def main():
    if len(sys.argv) < 2:
        print("用法: python3 validate-json.py <json_file> [json_file2] ...")
        print("\n示例:")
        print("  python3 validate-json.py data/market.json")
        print("  python3 validate-json.py data/*.json")
        sys.exit(1)
    
    all_valid = True
    for file_path in sys.argv[1:]:
        if not validate_and_fix(file_path):
            all_valid = False
    
    sys.exit(0 if all_valid else 1)


if __name__ == "__main__":
    main()
