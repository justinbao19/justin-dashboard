export const CATEGORY_CONFIG = {
  macro: {
    title: '市场风向',
    deck: '聚焦宏观叙事、交易快讯和风险资产情绪，适合盘前快速扫一遍。',
    sources: [
      ['wallstreetcn-quick', '华尔街快讯'],
      ['wallstreetcn-hot', '华尔街最热'],
      ['cls-telegraph', '财联社电报'],
      ['cls-hot', '财联社热门'],
      ['jin10', '金十快讯'],
      ['xueqiu-hotstock', '雪球热门股']
    ]
  },
  general: {
    title: '综合速览',
    deck: '主流媒体热点，适合先抓当天最重要的公共议题和国际动态。',
    sources: [
      ['thepaper', '澎湃热榜'],
      ['tencent-hot', '腾讯新闻'],
      ['ifeng', '凤凰热点'],
      ['zaobao', '联合早报'],
      ['cankaoxiaoxi', '参考消息']
    ]
  },
  tech: {
    title: '科技情报',
    deck: '产品、开发者生态与全球科技趋势，适合日常跟踪行业节奏。',
    sources: [
      ['ithome', 'IT之家'],
      ['36kr-quick', '36氪快讯'],
      ['github-trending-today', 'GitHub Trending'],
      ['hackernews', 'Hacker News'],
      ['producthunt', 'Product Hunt'],
      ['juejin', '稀土掘金']
    ]
  },
  social: {
    title: '社交热榜',
    deck: '平台热搜和话题外溢，适合观察大众关注点和传播速度。',
    sources: [
      ['weibo', '微博热搜'],
      ['zhihu', '知乎热榜'],
      ['baidu', '百度热搜'],
      ['toutiao', '头条热榜'],
      ['bilibili-hot-search', 'B站热搜'],
      ['douyin', '抖音热榜']
    ]
  }
};
