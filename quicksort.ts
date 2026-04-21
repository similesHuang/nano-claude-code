/**
 * 快速排序算法实现
 * 时间复杂度: 平均 O(n log n), 最坏 O(n²)
 * 空间复杂度: O(log n)
 */

export class Quicksort {
  /**
   * 对数组进行原地快速排序
   */
  static sort<T>(arr: T[], compareFn?: (a: T, b: T) => number): T[] {
    if (!Array.isArray(arr) || arr.length <= 1) {
      return arr;
    }

    const comparator = compareFn ?? ((a: T, b: T) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    this.quicksort(arr, 0, arr.length - 1, comparator);
    return arr;
  }

  /**
   * 快速排序核心递归
   */
  private static quicksort<T>(
    arr: T[],
    low: number,
    high: number,
    compareFn: (a: T, b: T) => number
  ): void {
    if (low < high) {
      const pivotIndex = this.partition(arr, low, high, compareFn);
      this.quicksort(arr, low, pivotIndex - 1, compareFn);
      this.quicksort(arr, pivotIndex + 1, high, compareFn);
    }
  }

  /**
   * 分区操作，返回基准值的最终位置
   */
  private static partition<T>(
    arr: T[],
    low: number,
    high: number,
    compareFn: (a: T, b: T) => number
  ): number {
    // 选择最后一个元素作为基准
    const pivot = arr[high];
    let i = low - 1;

    for (let j = low; j < high; j++) {
      if (compareFn(arr[j], pivot) <= 0) {
        i++;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }

    // 将基准放到中间位置
    [arr[i + 1], arr[high]] = [arr[high], arr[i + 1]];
    return i + 1;
  }
}

// ==================== 测试代码 ====================
if (require.main === module) {
  // 测试数字数组
  const numbers = [64, 34, 25, 12, 22, 11, 90];
  console.log('原始数组:', numbers);
  Quicksort.sort(numbers);
  console.log('排序后:', numbers);

  // 测试字符串数组
  const strings = ['banana', 'apple', 'cherry', 'date'];
  console.log('\n原始字符串:', strings);
  Quicksort.sort(strings);
  console.log('排序后:', strings);

  // 测试自定义比较
  const objects = [
    { name: 'Alice', age: 25 },
    { name: 'Bob', age: 30 },
    { name: 'Charlie', age: 20 }
  ];
  console.log('\n按年龄排序:');
  Quicksort.sort(objects, (a, b) => a.age - b.age);
  console.log(objects);
}