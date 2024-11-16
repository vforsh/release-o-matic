/**
 * @return {string} - строка в формате YYYY-MM-DD hh:mm:ss
 */
export function toReadableDateString(timestampMs: number, precision: 'minutes' | 'seconds' | 'ms' = 'seconds'): string {
	const date = new Date(timestampMs)

	const year = date.getFullYear()
	const month = (date.getMonth() + 1).toString().padStart(2, '0')
	const day = date.getDate().toString().padStart(2, '0')

	const hours = date.getHours().toString().padStart(2, '0')
	const minutes = date.getMinutes().toString().padStart(2, '0')
	const seconds = date.getSeconds().toString().padStart(2, '0')
	const ms = date.getMilliseconds().toString().padStart(3, '0')

	if (precision === 'minutes') {
		return `${year}-${month}-${day} ${hours}:${minutes}`
	} else if (precision === 'seconds') {
		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
	} else {
		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`
	}
}

/**
 * @return {number} - timestamp в миллисекундах
 */
export function fromReadableDateString(dateString: string): number {
	const dateTime = dateString.split(' ')
	const dateParts = dateTime[0].split('-')
	const timeParts = dateTime[1].split(':')

	const year = Number(dateParts[0])
	const month = Number(dateParts[1]) - 1
	const day = Number(dateParts[2])

	const hours = Number(timeParts[0])
	const minutes = Number(timeParts[1])
	let seconds = 0
	let milliseconds = 0

	if (timeParts[2]) {
		const secMilliParts = timeParts[2].split('.')
		seconds = Number(secMilliParts[0])

		if (secMilliParts[1]) {
			milliseconds = Number(secMilliParts[1])
		}
	}

	const dateObject = new Date(year, month, day, hours, minutes, seconds, milliseconds)

	return dateObject.getTime()
}

export function isReadableDateString(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?$/.test(value)
}
