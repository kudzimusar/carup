// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import DealerReviewerLayout from './DealerReviewerLayout'

const session=vi.hoisted(()=>({
  current:{
    user:null as null|{role:string},
    token:null as string|null,
    loading:false,
    logout:()=>{},
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
})
