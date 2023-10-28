import { Hono } from 'hono'

type ReleaseInfo = {
	current: boolean
	key: string,
	index: string,
	files: string,
	releasedAt: number,
}

const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))

app.get('/list', (ctx) => {
	return ctx.json([{
		current: true,
		key: 'master-11',
		index: 'index_master-11.html',
		files: 'files_master-11.json',
		releasedAt: Date.now(),
	}, {
		current: false,
		key: 'master-10',
		index: 'index_master-10.html',
		files: 'files_master-10.json',
		releasedAt: Date.now() - 10_000,
	}] as ReleaseInfo[])
})

export default app
