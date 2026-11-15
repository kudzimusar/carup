// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {act,cleanup,render,screen} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import DealerReviewerLayout from './DealerReviewerLayout'

const session=vi.hoisted(()=>({
  current:{
    user:null as null|{role:string},
    token:null as string|null,
    loading:false,
    logout:(()=>{}) as ()=>unknown,
  }
}))
vi.mock('@/context/AuthContext',()=>({useAuth:()=>session.current}))

function openReview(){
 return render(
  <MemoryRouter initialEntries={['/admin/dealer-claims']}>
   <Routes>
    <Route element={<DealerReviewerLayout/>}>
      <Route path="/admin/dealer-claims" element={<p>CANONICAL_REVIEW_WORKBENCH</p>}/>
    </Route>
    <Route path="/login" element={<p>LOGIN_REQUIRED</p>}/>
    <Route path="/" element={<p>ACCESS_DENIED_HOME</p>}/>
   </Routes>
  </MemoryRouter>
 )
}
describe('D6 independently authorized dealership reviewer shell',()=>{
 beforeEach(()=>{session.current={user:null,token:null,loading:false,logout:()=>{}}})
 afterEach(()=>cleanup())
 it('allows verified-role review UI without granting a general admin dashboard',()=>{
  session.current={user:{role:'reviewer'},token:'fictional-db-backed-token',
    loading:false,logout:()=>{}}
  openReview()
  expect(screen.getByText('CANONICAL_REVIEW_WORKBENCH')).toBeTruthy()
  expect(screen.getByRole('navigation',{name:'Dealership review workbenches'})).toBeTruthy()
  expect(screen.queryByText('User Management')).toBeNull()
 })
 it('also allows the existing administrative reviewers',()=>{
  session.current={user:{role:'admin'},token:'fictional-db-backed-token',
    loading:false,logout:()=>{}}
  openReview()
  expect(screen.getByText('CANONICAL_REVIEW_WORKBENCH')).toBeTruthy()
 })
 it('requires a proven login token; never trusts an asserted user object alone',()=>{
  session.current={user:{role:'reviewer'},token:null,loading:false,logout:()=>{}}
  openReview()
  expect(screen.getByText('LOGIN_REQUIRED')).toBeTruthy()
  expect(screen.queryByText('CANONICAL_REVIEW_WORKBENCH')).toBeNull()
 })
 it('refuses claimant/owner from seeing independent review workbenches',()=>{
  session.current={user:{role:'owner'},token:'fictional-claimant-token',
    loading:false,logout:()=>{}}
  openReview()
  expect(screen.getByText('ACCESS_DENIED_HOME')).toBeTruthy()
  expect(screen.queryByText('CANONICAL_REVIEW_WORKBENCH')).toBeNull()
 })
 it('TI-10: Sign out awaits server revocation, then leaves in-app (never fire-and-forget)',async()=>{
  let finish!:(outcome:string)=>void
  const revocation=new Promise<string>(resolve=>{finish=resolve})
  const logout=vi.fn(()=>revocation)
  session.current={user:{role:'reviewer'},token:'fictional-db-backed-token',loading:false,logout}
  openReview()
  await userEvent.setup().click(screen.getByRole('button',{name:/sign out/i}))
  expect(logout).toHaveBeenCalledTimes(1)
  // Still inside the workbench while the revocation request is in flight.
  expect(screen.getByText('CANONICAL_REVIEW_WORKBENCH')).toBeTruthy()
  await act(async()=>{finish('revoked');await revocation})
  // Then an in-app navigation to the public home (this fixture renders "/" as ACCESS_DENIED_HOME).
  expect(await screen.findByText('ACCESS_DENIED_HOME',{},{timeout:1500})).toBeTruthy()
  expect(screen.queryByText('CANONICAL_REVIEW_WORKBENCH')).toBeNull()
 })
})
