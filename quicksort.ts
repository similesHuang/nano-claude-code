/**
 * 快速排序算法实现
 * 采用 Lomuto 分区方案
 */

/**
 * 分区函数：将数组以 pivot 为基准分成两部分
 * @param arr 待排序数组
 * @param low 起始索引
 * @param high 结束索引
 * @param compare 比较函数
 * @returns pivot 的最终位置
 */
function partition<T>(
  arr: T[],
  low: number,
  high: number,
  compare: (a: T, b: T) => number
): number {
  // 选择最右侧元素作为 pivot
  const pivot = arr[high];
  let i = low - 1;

  for (let j = low; j < high; j++) {
    // 小于等于 pivot 的元素移到左侧
    if (compare(arr[j], pivot) <= 0) {
      i++;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // 将 pivot 放到正确位置
  [arr[i + 1], arr[high]] = [arr[high], arr[i + 1]];
  return i + 1;
}

/**
 * 快速排序核心函数
 * @param arr 待排序数组
 * @param low 起始索引
 * @param high 结束索引
 * @param compare 比较函数
 */
function quickSort<T>(
  arr: T[],
  low: number,
  high: number,
  compare: (a: T, b: T) => number
): void {
  if (low < high) {
    // 获取 pivot 位置
    const pivotIndex = partition(arr, low, high, compare);
    // 递归排序左右两部分
    quickSort(arr, low, pivotIndex - 1, compare);
    quickSort(arr, pivotIndex + 1, high, compare);
  }
}

/**
 * 默认比较函数（适用于 number, string 等基本类型）
 */
function defaultCompare<T extends number | string>(a: T, b: T): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * 快速排序入口函数
 * @param arr 待排序数组
 * @param compare 自定义比较函数，默认为数值/字符串比较
 * @returns 排序后的新数组（原数组不受影响）
 */
function sort<T>(
  arr: T[],
  compare: (a: T, b: T) => number = defaultCompare as (a: T, b: T) => number
): T[] {
  if (arr.length <= 1) return [...arr];
  
  const result = [...arr];
  quickSort(result, 0, result.length - 1, compare);
  return result;
}

export default sort;
